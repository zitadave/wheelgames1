import { Server, Socket } from "socket.io";
import { supabase } from "./supabase.js";

export type Side = "even" | "odd";

export interface PlayerInfo {
  userId: string;
  username: string;
  photoUrl: string;
}

export interface PlayerBet {
  userId: string;
  username: string;
  photoUrl: string;
  amount: number;
  number?: number; // Optional: 1-6
  side: Side;
  partial: boolean;
}

export interface RoomState {
  id: string;
  roundId: number;
  status: "betting" | "balancing" | "spinning" | "result";
  timeLeft: number;
  players: Record<string, PlayerBet>;
  numbersTaken: Record<number, PlayerInfo>; // Track who took which number
  pools: { even: number; odd: number };
  feed: string[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
  onlineCount?: number;
}

const MAX_CAPACITY = 200;
const BETTING_TIME = 60; // 0-55 open, 55-60 soft close (UI handles soft close)
const BALANCING_TIME = 10;
const SPINNING_TIME = 60;
const RESULT_TIME = 6; // Show result before restarting

class Room {
  state: RoomState;
  private timer: NodeJS.Timeout | null = null;
  private io: Server;
  private roundIdCounter = 1;

  constructor(id: string, io: Server) {
    this.io = io;
    this.state = {
      id,
      roundId: this.roundIdCounter,
      status: "betting",
      timeLeft: BETTING_TIME,
      players: {},
      pools: { even: 0, odd: 0 },
      feed: [],
      capacity: { even: 0, odd: 0 },
      numbersTaken: {},
      onlineCount: 15,
    };
    this.initRoundCounterAndStart();
  }

  private async initRoundCounterAndStart() {
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from("rounds")
          .select("round_number")
          .eq("room_id", this.state.id)
          .order("round_number", { ascending: false })
          .limit(1);
          
        if (!error && data && data.length > 0) {
          this.roundIdCounter = data[0].round_number;
          console.log(`Persistent Round ID Counter initialized to ${this.roundIdCounter} from database for room ${this.state.id}`);
        }
      }
    } catch (err) {
      console.error("Failed to fetch latest round_number from Supabase:", err);
    }
    this.startLoop();
  }

  public updateOnlineCount() {
    const clientsInRoom = this.io.sockets.adapter.rooms.get(this.state.id)?.size || 0;
    this.state.onlineCount = clientsInRoom;
  }

  private startLoop() {
    this.roundIdCounter++;
    this.state.roundId = this.roundIdCounter;
    this.state.status = "betting";
    this.state.timeLeft = BETTING_TIME;
    this.state.players = {};
    this.state.pools = { even: 0, odd: 0 };
    this.state.feed = [];
    this.state.capacity = { even: 0, odd: 0 };
    this.state.numbersTaken = {};
    this.state.winner = undefined;

    this.updateOnlineCount();
    this.broadcastState();

    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  private tick() {
    this.state.timeLeft -= 1;
    this.broadcastState();

    if (this.state.timeLeft <= 0) {
      this.transitionState();
    }
  }

  private async transitionState() {
    if (this.timer) clearInterval(this.timer);

    switch (this.state.status) {
      case "betting":
        await this.doBalancing();
        break;
      case "balancing":
        this.startSpinning();
        break;
      case "spinning":
        this.showResult();
        break;
      case "result":
        this.startLoop();
        break;
    }
  }

  private async doBalancing() {
    this.state.status = "balancing";
    this.state.timeLeft = BALANCING_TIME;

    // Balancing Logic
    // If one pool is 0, House Bot joins
    if (this.state.pools.even > 0 && this.state.pools.odd === 0) {
      this.state.pools.odd = this.state.pools.even;
      this.state.feed.unshift(`🤖 House Bot matched ${this.state.pools.even} on ጎደል (ODD)!`);
    } else if (this.state.pools.odd > 0 && this.state.pools.even === 0) {
      this.state.pools.even = this.state.pools.odd;
      this.state.feed.unshift(`🤖 House Bot matched ${this.state.pools.odd} on ሞላ (EVEN)!`);
    } else {
      // P2P Match - balance the pools
      if (this.state.pools.even !== this.state.pools.odd) {
        const overSide = this.state.pools.even > this.state.pools.odd ? 'even' : 'odd';
        const underSide = overSide === 'even' ? 'odd' : 'even';
        const targetPool = this.state.pools[underSide];
        
        let currentOverPool = 0;
        // Sort players by timestamp or just array order (first come first served)
        const overPlayers = Object.values(this.state.players).filter(p => p.side === overSide);
        
        for (const p of overPlayers) {
          if (currentOverPool + p.amount <= targetPool) {
            currentOverPool += p.amount;
          } else {
            // This bet crosses the threshold
            const remaining = targetPool - currentOverPool;
            if (remaining > 0 && p.partial) {
              // Refund the difference
              const refund = p.amount - remaining;
              p.amount = remaining;
              currentOverPool += remaining;
              this.state.feed.unshift(`${p.username}'s bet downscaled to match pool.`);
              
              // Log refund to Supabase
              try {
                if (supabase) {
                   const { data: userData } = await supabase.from("users").select("balance").eq("id", p.userId).single();
                   if (userData) {
                      const newBalance = Number(userData.balance) + refund;
                      await supabase.from("users").update({ balance: newBalance }).eq("id", p.userId);
                      await supabase.from("transactions").insert({
                        user_id: p.userId,
                        amount: refund,
                        type: 'refund',
                        description: 'Even/Odd Pool Limit Refund'
                      });
                      this.io.to(p.userId).emit('balanceUpdated', { userId: p.userId, balance: newBalance });
                   }
                }
              } catch (e) { console.error("Refund logging error:", e); }

              this.io.to(p.userId).emit('refund', refund);
            } else {
              // Reject the whole bet
              const refund = p.amount;
              p.amount = 0; // effectively removed
              this.state.feed.unshift(`${p.username}'s bet skipped (pool limit).`);
              
              // Log refund to Supabase
              try {
                if (supabase) {
                   const { data: userData } = await supabase.from("users").select("balance").eq("id", p.userId).single();
                   if (userData) {
                      const newBalance = Number(userData.balance) + refund;
                      await supabase.from("users").update({ balance: newBalance }).eq("id", p.userId);
                      await supabase.from("transactions").insert({
                        user_id: p.userId,
                        amount: refund,
                        type: 'refund',
                        description: 'Even/Odd Pool Limit Refund'
                      });
                      this.io.to(p.userId).emit('balanceUpdated', { userId: p.userId, balance: newBalance });
                   }
                }
              } catch (e) { console.error("Refund logging error:", e); }
              
              this.io.to(p.userId).emit('refund', refund);
            }
          }
        }
        this.state.pools[overSide] = targetPool;
      }
    }

    // Determine winner early for animation
    const hasHouseBotEven = this.state.pools.even > 0 && this.state.pools.odd > 0 && Object.values(this.state.players).every(p => p.amount === 0 || p.side === 'odd');
    const hasHouseBotOdd = this.state.pools.even > 0 && this.state.pools.odd > 0 && Object.values(this.state.players).every(p => p.amount === 0 || p.side === 'even');
    
    let isEvenWinner = false;
    if (hasHouseBotEven) {
       isEvenWinner = Math.random() < 0.75;
    } else if (hasHouseBotOdd) {
       isEvenWinner = Math.random() > 0.75;
    } else {
       isEvenWinner = Math.random() > 0.5;
    }

    // Even numbers: 2, 4, 6. Odd numbers: 1, 3, 5
    const evenNumbers = [2, 4, 6];
    const oddNumbers = [1, 3, 5];
    this.state.winner = isEvenWinner 
      ? evenNumbers[Math.floor(Math.random() * evenNumbers.length)] 
      : oddNumbers[Math.floor(Math.random() * oddNumbers.length)];

    this.broadcastState();

    this.timer = setInterval(() => this.tick(), 1000);
  }

  private startSpinning() {
    this.state.status = "spinning";
    this.state.timeLeft = SPINNING_TIME;
    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private async showResult() {
    this.state.status = "result";
    this.state.timeLeft = RESULT_TIME;
    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);

    // Async save to Supabase
    try {
      if (supabase) {
        // Save round
        const { data: roundData, error: roundError } = await supabase
          .from("rounds")
          .insert({
            round_number: this.state.roundId,
            winner: this.state.winner,
            pools_even: this.state.pools.even,
            pools_odd: this.state.pools.odd,
            room_id: this.state.id
          })
          .select()
          .single();
          
        if (roundError) {
          console.error("Error saving round to Supabase:", roundError);
        } else if (roundData) {
          // Save bets
          const betsToInsert = Object.values(this.state.players).map(p => ({
            round_id: roundData.id,
            user_id: p.userId,
            username: p.username,
            amount: p.amount,
            side: p.side
          })).filter(b => b.amount > 0);
          
          if (betsToInsert.length > 0) {
            const { error: betsError } = await supabase
              .from("bets")
              .insert(betsToInsert);
            if (betsError) console.error("Error saving bets to Supabase:", betsError);
          }
        }
      }
    } catch (err) {
      console.error("Failed to connect to Supabase for logging:", err);
    }
  }

  public broadcastState() {
    this.io.to(this.state.id).emit("roomState", this.state);
  }

  public placeBet(userId: string, username: string, photoUrl: string, amount: number, side: Side, number: number | undefined, partial: boolean) {
    if (this.state.status !== "betting" || this.state.timeLeft < 5) {
      return { success: false, message: "Betting is closed for this round." };
    }

    if (number !== undefined && number >= 1 && number <= 6) {
        if (this.state.numbersTaken[number]) {
          return { success: false, message: "This number is already taken." };
        }
    }

    const existingBet = this.state.players[userId];

    if (existingBet) {
      const oldAmount = existingBet.amount;
      const oldSide = existingBet.side;
      const oldNumber = existingBet.number;
      
      if (oldNumber !== undefined) {
         this.state.numbersTaken[oldNumber] = { userId: "", username: "", photoUrl: "" }; // Free old number
      }
      
      this.state.pools[oldSide] -= oldAmount;
      this.state.pools[side] += amount;
      
      existingBet.amount = amount;
      existingBet.side = side;
      existingBet.number = number;
      existingBet.photoUrl = photoUrl;
      existingBet.partial = partial;
      
      if (number !== undefined) {
        this.state.numbersTaken[number] = { userId, username, photoUrl };
      }
      
      const sideName = side === 'even' ? 'ሞላ (Even)' : 'ጎደል (Odd)';
      const numberStr = number !== undefined ? ` (${number})` : '';
      this.state.feed.unshift(`${username} updated bet to ${amount.toLocaleString()} on ${sideName}${numberStr}!`);
    } else {
      this.state.players[userId] = { userId, username, photoUrl, amount, number, side, partial };
      this.state.pools[side] += amount;
      
      if (number !== undefined) {
        this.state.numbersTaken[number] = { userId, username, photoUrl };
      }
      
      const sideName = side === 'even' ? 'ሞላ (Even)' : 'ጎደል (Odd)';
      const numberStr = number !== undefined ? ` (${number})` : '';
      this.state.feed.unshift(`${username} placed ${amount.toLocaleString()} on ${sideName}${numberStr}!`);
    }

    if (this.state.feed.length > 10) this.state.feed.pop();
    this.broadcastState();

    // Instant lock if both sides full
    if (Object.keys(this.state.numbersTaken).length >= 6) {
       this.transitionState(); // Move to balancing instantly
    }

    return { success: true };
  }
}

export function initGameEngine(io: Server) {
  const rooms = {
    "Main-Room": new Room("Main-Room", io),
  };

  // Setup Realtime Listener for Balance Changes
  import("./supabase.js").then(({ supabase }) => {
    if (supabase) {
      supabase.channel('public:users')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
          const updatedUser = payload.new;
          if (updatedUser && updatedUser.id) {
            io.to(`user_${updatedUser.id}`).emit('syncBalance', updatedUser.balance);
          }
        })
        .subscribe();
    }
  }).catch(console.error);

  io.on("connection", (socket: Socket) => {
    let currentRoomId: string | null = null;
    
    // Auth & Balance syncing
    socket.on("syncUser", async (userId: string, username: string, photoUrl?: string, firstName?: string, lastName?: string) => {
      // Join a personal room to receive private realtime updates
      socket.join(`user_${userId}`);
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        // Upsert user with Telegram info
        const { data, error } = await supabase
          .from("users")
          .upsert({ 
            id: userId, 
            username,
            ...(photoUrl ? { photo_url: photoUrl } : {}),
            ...(firstName ? { first_name: firstName } : {}),
            ...(lastName ? { last_name: lastName } : {})
          }, { onConflict: 'id' })
          .select()
          .single();
          
        if (!error && data) {
           socket.emit("syncBalance", data.balance);
        }
      } catch (e) {
        console.error("Sync user error:", e);
      }
    });

    socket.on("logTransaction", async (data: { userId: string, amount: number, type: string, description: string, newBalance: number }) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        await supabase.from("users").update({ balance: data.newBalance }).eq("id", data.userId);
        await supabase.from("transactions").insert({
           user_id: data.userId,
           amount: data.amount,
           type: data.type,
           description: data.description
        });

        // Auto-sync client with the latest 50 transactions from DB
        const { data: txData, error: txError } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!txError && txData) {
          socket.emit("userTransactions", txData);
        }
      } catch (e) {
         console.error("Log tx error:", e);
      }
    });

    socket.on("logGamePlay", async (data: { userId: string, gameType: string, result: string, winAmount: number, newBalance: number }) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        
        await supabase.from("users").update({ balance: data.newBalance }).eq("id", data.userId);
        await supabase.from("game_logs").insert({
           user_id: data.userId,
           game_type: data.gameType,
           result: data.result,
           win_amount: data.winAmount
        });

        // Auto-sync client with the latest 50 game logs from DB
        const { data: logsData, error: logsError } = await supabase
          .from("game_logs")
          .select("*")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!logsError && logsData) {
          socket.emit("userGameLogs", logsData);
        }
      } catch (e) {
         console.error("Log game error:", e);
      }
    });

    socket.on("getUserTransactions", async (userId: string) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        const { data, error } = await supabase
          .from("transactions")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) {
          socket.emit("userTransactions", data);
        }
      } catch (e) {
        console.error("Get tx error:", e);
      }
    });

    socket.on("getUserGameLogs", async (userId: string) => {
      try {
        const { supabase } = await import("./supabase.js");
        if (!supabase) return;
        const { data, error } = await supabase
          .from("game_logs")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);
        if (!error && data) {
          socket.emit("userGameLogs", data);
        }
      } catch (e) {
        console.error("Get game logs error:", e);
      }
    });

    socket.on("joinRoom", (roomId: string) => {
      if (currentRoomId) {
        socket.leave(currentRoomId);
      }
      socket.join(roomId);
      currentRoomId = roomId;
      if (rooms[roomId as keyof typeof rooms]) {
        const r = rooms[roomId as keyof typeof rooms];
        r.updateOnlineCount();
        socket.emit("roomState", r.state);
        r.broadcastState();
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && rooms[currentRoomId as keyof typeof rooms]) {
        const r = rooms[currentRoomId as keyof typeof rooms];
        r.updateOnlineCount();
        r.broadcastState();
      }
    });

    socket.on("getRoomsStatus", () => {
      const status = Object.keys(rooms).reduce((acc, key) => {
        const room = rooms[key as keyof typeof rooms];
        acc[key] = {
           status: room.state.status,
           even: room.state.capacity.even,
           odd: room.state.capacity.odd
        };
        return acc;
      }, {} as Record<string, any>);
      socket.emit("roomsStatus", status);
    });

    socket.on("placeBet", (data: { roomId: string, userId: string, username: string, photoUrl: string, amount: number, side: Side, number: number | undefined, partial: boolean }, callback) => {
      const room = rooms[data.roomId as keyof typeof rooms];
      if (room) {
        const result = room.placeBet(data.userId, data.username, data.photoUrl, data.amount, data.side, data.number, data.partial);
        if (callback) callback(result);
      } else {
        if (callback) callback({ success: false, message: "Room not found." });
      }
    });
  });
}
