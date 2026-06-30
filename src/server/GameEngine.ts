import { Server, Socket } from "socket.io";

export type Side = "even" | "odd";

export interface PlayerBet {
  userId: string;
  username: string;
  amount: number;
  side: Side;
  partial: boolean;
}

export interface RoomState {
  id: string;
  roundId: number;
  status: "betting" | "balancing" | "spinning" | "result";
  timeLeft: number;
  players: Record<string, PlayerBet>;
  pools: { even: number; odd: number };
  feed: string[];
  capacity: { even: number; odd: number };
  winner?: number; // 1-6
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
    };
    this.startLoop();
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
    this.state.winner = undefined;
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

  private transitionState() {
    if (this.timer) clearInterval(this.timer);

    switch (this.state.status) {
      case "betting":
        this.doBalancing();
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

  private doBalancing() {
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
              // Need a way to notify client to refund their local balance,
              // for this prototype, we'll emit a specific event or they get balance updated at end.
              this.io.to(p.userId).emit('refund', refund);
            } else {
              // Reject the whole bet
              const refund = p.amount;
              p.amount = 0; // effectively removed
              this.state.feed.unshift(`${p.username}'s bet skipped (pool limit).`);
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

  private showResult() {
    this.state.status = "result";
    this.state.timeLeft = RESULT_TIME;
    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private broadcastState() {
    this.io.to(this.state.id).emit("roomState", this.state);
  }

  public placeBet(userId: string, username: string, amount: number, side: Side, partial: boolean) {
    if (this.state.status !== "betting" || this.state.timeLeft < 5) {
      return { success: false, message: "Betting is closed for this round." };
    }

    const existingBet = this.state.players[userId];

    if (existingBet) {
      const oldAmount = existingBet.amount;
      const oldSide = existingBet.side;
      
      if (oldSide !== side) {
         if (this.state.capacity[side] >= MAX_CAPACITY) {
           return { success: false, message: "Room capacity reached for this side." };
         }
         this.state.capacity[oldSide] -= 1;
         this.state.capacity[side] += 1;
      }
      
      this.state.pools[oldSide] -= oldAmount;
      this.state.pools[side] += amount;
      
      existingBet.amount = amount;
      existingBet.side = side;
      existingBet.partial = partial;
      
      const sideName = side === 'even' ? 'ሞላ (Even)' : 'ጎደል (Odd)';
      this.state.feed.unshift(`${username} updated bet to ${amount.toLocaleString()} on ${sideName}!`);
    } else {
      if (this.state.capacity[side] >= MAX_CAPACITY) {
        return { success: false, message: "Room capacity reached for this side." };
      }
      this.state.players[userId] = { userId, username, amount, side, partial };
      this.state.capacity[side] += 1;
      this.state.pools[side] += amount;
      
      const sideName = side === 'even' ? 'ሞላ (Even)' : 'ጎደል (Odd)';
      this.state.feed.unshift(`${username} placed ${amount.toLocaleString()} on ${sideName}!`);
    }

    if (this.state.feed.length > 10) this.state.feed.pop();
    this.broadcastState();

    // Instant lock if both sides full
    if (this.state.capacity.even >= MAX_CAPACITY && this.state.capacity.odd >= MAX_CAPACITY) {
       this.transitionState(); // Move to balancing instantly
    }

    return { success: true };
  }
}

export function initGameEngine(io: Server) {
  const rooms = {
    "Main-Room": new Room("Main-Room", io),
  };

  io.on("connection", (socket: Socket) => {
    let currentRoomId: string | null = null;

    socket.on("joinRoom", (roomId: string) => {
      if (currentRoomId) {
        socket.leave(currentRoomId);
      }
      socket.join(roomId);
      currentRoomId = roomId;
      if (rooms[roomId as keyof typeof rooms]) {
        socket.emit("roomState", rooms[roomId as keyof typeof rooms].state);
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

    socket.on("placeBet", (data: { roomId: string, userId: string, username: string, amount: number, side: Side, partial: boolean }, callback) => {
      const room = rooms[data.roomId as keyof typeof rooms];
      if (room) {
        const result = room.placeBet(data.userId, data.username, data.amount, data.side, data.partial);
        if (callback) callback(result);
      } else {
        if (callback) callback({ success: false, message: "Room not found." });
      }
    });
  });
}
