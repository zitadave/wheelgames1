import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { RoomState, Side } from './types';
import { Wheel } from './components/Wheel';
import { JackpotArena } from './components/JackpotArena';
import { WheelOfChance } from './components/WheelOfChance';
import { Users, Clock, History, AlertCircle, Coins, Moon, Sun, Settings, X, HelpCircle, Search, Trophy, Gamepad2, TrendingUp, Wallet, User, Plus, ArrowUpRight, ArrowDownLeft, Copy, Check, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { playWin, playLoss } from './utils/sound';
import { triggerHaptic } from './utils/haptic';

const SOCKET_URL = window.location.origin;

interface HistoryItem {
  roundId: number;
  winner: number;
  betAmount: number;
  betSide: Side;
  netWin: number;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [userId] = useState(() => 'user_' + Math.floor(Math.random() * 100000));
  const [username] = useState(() => 'Player_' + Math.floor(Math.random() * 1000));
  const [balance, setBalance] = useState(100000); // 100k start
  const [currentRoom, setCurrentRoom] = useState<string>('Main-Room');
  const [roomsStatus, setRoomsStatus] = useState<Record<string, { status: string, even: number, odd: number }>>({});
  const [roomState, setRoomState] = useState<RoomState | null>(null);

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [failedBet, setFailedBet] = useState<{ side: Side; amount: number } | null>(null);
  const [isPlacingBet, setIsPlacingBet] = useState<boolean>(false);

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => {
      setNotification(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const [betAmount, setBetAmount] = useState<number>(1000);
  const [partialBet, setPartialBet] = useState<boolean>(true);
  const [showResult, setShowResult] = useState<boolean>(false);
  const [lastWinner, setLastWinner] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  const [pulseSide, setPulseSide] = useState<Side | null>(null);
  
  const [soundTicks, setSoundTicks] = useState<boolean>(true);
  const [soundAlerts, setSoundAlerts] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const soundAlertsRef = useRef(true);
  
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    return localStorage.getItem('onboardingSeen') !== 'true';
  });

  const [isPlayersDrawerOpen, setIsPlayersDrawerOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [extraBrowsers, setExtraBrowsers] = useState<number>(42);

  // Bottom Navigation & Mini Pages State
  const [activeTab, setActiveTab] = useState<'even_odd' | 'jackpot' | 'chance' | 'profile'>('even_odd');
  const [isWalletOpen, setIsWalletOpen] = useState<boolean>(false);
  const [ledgerTab, setLedgerTab] = useState<'play' | 'transactions'>('play');
  const [isJackpotTheaterMode, setIsJackpotTheaterMode] = useState<boolean>(false);
  const [mockTransactions, setMockTransactions] = useState<any[]>([
    { id: 1, type: 'reward', desc: 'Welcome Bonus Credits', amount: 5000, date: 'Just now', positive: true },
    { id: 2, type: 'bet', desc: 'Even Side Placement (Round #92)', amount: -1000, date: '2 mins ago', positive: false },
    { id: 3, type: 'win', desc: 'Round Winning Bonus Multiplier', amount: 2000, date: '3 mins ago', positive: true },
  ]);

  const [gameHistory, setGameHistory] = useState<any[]>([
    { id: 'RND-8492A', type: 'Jackpot VIP Grand', bet: 10000, numbers: 'Spot #24', result: 'Loss', change: -10000, date: '10 mins ago', status: 'Completed' },
    { id: 'RND-88392B', type: 'Chance 1-10', bet: 500, numbers: 'Spot #7', result: '1st Place Win', change: 4000, date: '15 mins ago', status: 'Completed' },
    { id: 'RND-12492C', type: 'Even/Odd', bet: 2000, numbers: 'Even (ሞላ)', result: 'Loss', change: -2000, date: '1 hour ago', status: 'Completed' },
    { id: 'RND-94829D', type: 'Chance 1-20', bet: 1000, numbers: 'Spot #19', result: '2nd Place Win', change: 3000, date: '2 hours ago', status: 'Completed' },
    { id: 'RND-77392E', type: 'Jackpot Mini', bet: 1000, numbers: 'Spot #42', result: 'Loss', change: -1000, date: '3 hours ago', status: 'Completed' },
  ]);

  const [depositAmount, setDepositAmount] = useState<string>('5000');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('2000');
  const [withdrawHandle, setWithdrawHandle] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setExtraBrowsers(prev => {
        const change = Math.floor(Math.random() * 5) - 2;
        return Math.max(25, Math.min(65, prev + change));
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalActivePlayersCount = 100 + (roomState ? Object.keys(roomState.players).length : 0) + extraBrowsers;

  const vipPlayersList = React.useMemo(() => {
    const roundId = roomState?.roundId || 1;
    const realPlayers = roomState?.players || {};
    
    const seededRandom = (seed: number) => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const list: any[] = [];
    
    // Add real players first
    Object.entries(realPlayers).forEach(([id, playerObj]) => {
      const p = playerObj as any;
      list.push({
        id,
        username: p.username || `@User_${id.slice(5, 9)}`,
        amount: p.amount,
        side: p.side,
        badge: p.amount >= 10000 ? "Crown VIP" : p.amount >= 5000 ? "Gold VIP" : "VIP Pro",
        joinTime: "0.1s",
        isReal: true,
      });
    });

    const ethioUsernames = [
      'Bet_Master', 'Ethio_Rich', 'Queen_Sheba', 'Abyssinia_G', 'Lasta_Spins', 
      'Solomon_G', 'Lucy_Spins', 'Amare_B', 'Tadesse_W', 'Almaz_Y', 'Selam_A', 
      'Zenebe_K', 'Yared_M', 'Aster_A', 'Tedla_B', 'Hiwot_L', 'Mikael_T', 
      'Alem_H', 'Dawit_M', 'Kebede_G', 'Alpha_Spins', 'Apex_Bettor', 'Gold_Minder',
      'Lucky_Striker', 'Mega_Winner', 'Betting_Boss', 'Sintayehu_A', 'Mesfin_T',
      'Kiros_G', 'Frehiwot_K', 'Tsige_M', 'Biniyam_S', 'Elias_Y', 'Netsanet_B',
      'Tariku_L', 'Helen_G', 'Rahel_T', 'Senait_D', 'Girma_W', 'Fasil_M',
      'Zewdu_S', 'Kassa_H', 'Tefera_A', 'Yohannes_K', 'Martha_W', 'Lidya_M',
      'Muluken_B', 'Tewodros_Y', 'Menelik_II', 'Lalibela_G', 'Axum_Spins', 'Rift_Valley'
    ];

    const fillCount = Math.max(0, 100 - list.length);
    for (let i = 0; i < fillCount; i++) {
      const seed = roundId * 1000 + i;
      const r1 = seededRandom(seed);
      const r2 = seededRandom(seed + 1);
      const r3 = seededRandom(seed + 2);
      const r4 = seededRandom(seed + 3);

      const nameIndex = Math.floor(r1 * ethioUsernames.length);
      const baseUsername = ethioUsernames[nameIndex];
      const suffix = Math.floor(r2 * 900) + 100;
      const usernameStr = `@${baseUsername}_${suffix}`;

      const amountOpts = [500, 1000, 2000, 5000, 10000, 15000, 25000, 50000];
      const amount = amountOpts[Math.floor(r3 * amountOpts.length)];
      const side: Side = r4 > 0.5 ? 'even' : 'odd';

      let badge = "Early Bird";
      if (amount >= 25000) badge = "Apex Titan";
      else if (amount >= 15000) badge = "High Roller";
      else if (amount >= 5000) badge = "VIP Pro";
      else if (r1 > 0.8) badge = "Fast-Action";

      const joinSec = (0.2 + (i * 0.12) + (r2 * 0.08)).toFixed(1);
      const joinTime = `${joinSec}s`;

      list.push({
        id: `mock-${roundId}-${i}`,
        username: usernameStr,
        amount,
        side,
        badge,
        joinTime,
        isReal: false,
      });
    }

    return list.slice(0, 100);
  }, [roomState?.roundId, roomState?.players]);
  
  useEffect(() => {
    soundAlertsRef.current = soundAlerts;
  }, [soundAlerts]);

  const [isInputFocused, setIsInputFocused] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('roomsStatus', (status) => setRoomsStatus(status));
    
    const interval = setInterval(() => {
       newSocket.emit('getRoomsStatus');
    }, 2000);

    return () => {
      newSocket.disconnect();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => {
      socket.emit('joinRoom', currentRoom);
      socket.emit('getRoomsStatus');
    };

    if (socket.connected) {
      onConnect();
    }

    socket.on('connect', onConnect);

    return () => {
      socket.off('connect', onConnect);
    };
  }, [socket, currentRoom]);

  useEffect(() => {
    if (!socket) return;
    
    socket.on('roomState', (state: RoomState) => {
      setRoomState(state);

      if (state.status === 'result' && state.winner) {
        if (!showResult && lastWinner !== state.winner) {
          setShowResult(true);
          setLastWinner(state.winner);
          triggerHaptic('notification', 'success');
          let fireConfetti = confetti as any;
          if (typeof confetti === 'function') {
            fireConfetti = confetti;
          } else if (confetti && typeof (confetti as any).default === 'function') {
            fireConfetti = (confetti as any).default;
          }
          
          if (fireConfetti && typeof fireConfetti.create === 'function') {
            const customConfetti = fireConfetti.create(null, { resize: true, useWorker: false });
            customConfetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          } else {
            fireConfetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          }
          
          // Check if we won
          const myBet = state.players[userId];
          if (myBet) {
             const isEven = state.winner % 2 === 0;
             const mySideWon = (isEven && myBet.side === 'even') || (!isEven && myBet.side === 'odd');
             let netWin = -myBet.amount;
             if (mySideWon) {
                // Determine net win based on fees
                const feeRate = myBet.amount > 10000 ? 0.05 : 0.10;
                netWin = myBet.amount * (1 - feeRate);
                setBalance(b => b + myBet.amount + netWin);
                if (soundAlertsRef.current) playWin();
             } else {
                if (soundAlertsRef.current) playLoss();
             }

             setHistory(prev => {
                if (prev.some(h => h.roundId === state.roundId)) return prev;
                const newItem: HistoryItem = { 
                   roundId: state.roundId, 
                   winner: state.winner!, 
                   betAmount: myBet.amount, 
                   betSide: myBet.side, 
                   netWin 
                };
                return [newItem, ...prev].slice(0, 5);
             });
          }
        }
      } else {
        setShowResult(false);
        setLastWinner(null);
      }
    });

    socket.on('refund', (amount: number) => {
      setBalance(b => b + amount);
    });

    return () => {
      socket.off('roomState');
      socket.off('refund');
    };
  }, [socket, showResult, lastWinner, userId]);

  const handleJoinRoom = (roomId: string) => {
    if (socket) {
      socket.emit('joinRoom', roomId);
      setCurrentRoom(roomId);
    }
  };

  const handlePlaceBet = (side: Side, retryAmount?: number) => {
    const targetAmount = retryAmount !== undefined ? retryAmount : betAmount;
    if (!socket) {
      showNotification("Not connected to server. Retrying connection...", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (!roomState) {
      showNotification("Waiting for room state. Please wait...", "info");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (roomState.status !== 'betting') {
      showNotification("Betting is not active right now.", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }
    if (roomState.timeLeft < 5) {
      showNotification("Betting is closed for this round.", "error");
      setFailedBet({ side, amount: targetAmount });
      return;
    }

    const myBet = roomState.players[userId];
    const currentBetAmount = myBet ? myBet.amount : 0;
    const diff = targetAmount - currentBetAmount;

    if (balance < diff) {
       showNotification("Insufficient balance for this bet!", "error");
       setFailedBet({ side, amount: targetAmount });
       return;
    }

    setIsPlacingBet(true);
    setFailedBet(null);

    let hasResponded = false;
    const timeoutTimer = setTimeout(() => {
      if (!hasResponded) {
        setIsPlacingBet(false);
        setFailedBet({ side, amount: targetAmount });
        showNotification("Bet placement timed out. Try again?", "error");
      }
    }, 4000);

    socket.emit('placeBet', {
      roomId: currentRoom,
      userId,
      username,
      amount: targetAmount,
      side,
      partial: partialBet
    }, (res: any) => {
      hasResponded = true;
      clearTimeout(timeoutTimer);
      setIsPlacingBet(false);

      if (res && res.success) {
         setBalance(b => b - diff);
         setPulseSide(side);
         setTimeout(() => setPulseSide(null), 300);
         if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
         }
         showNotification(`Successfully placed ${targetAmount.toLocaleString()} bet!`, "success");
      } else {
         const errMsg = res?.message || "Server failed to process bet.";
         showNotification(errMsg, "error");
         setFailedBet({ side, amount: targetAmount });
      }
    });
  };

  const handlePlaceBetRef = useRef(handlePlaceBet);
  const setBetAmountRef = useRef(setBetAmount);

  useEffect(() => {
    handlePlaceBetRef.current = handlePlaceBet;
    setBetAmountRef.current = setBetAmount;
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showOnboarding || showSettings) return;

      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Enter') {
          e.preventDefault();
          (document.activeElement as HTMLElement).blur();
          handlePlaceBetRef.current('even');
        }
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        handlePlaceBetRef.current('even');
      } else if (e.key === '1') {
        setBetAmountRef.current(1000);
      } else if (e.key === '2') {
        setBetAmountRef.current(2000);
      } else if (e.key === '5') {
        setBetAmountRef.current(5000);
      } else if (e.key === '0') {
        setBetAmountRef.current(10000);
      } else if (e.key.toLowerCase() === 'e') {
        handlePlaceBetRef.current('even');
      } else if (e.key.toLowerCase() === 'o') {
        handlePlaceBetRef.current('odd');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOnboarding, showSettings]);

  const isSoftClosed = roomState?.status === 'betting' && roomState.timeLeft < 5;

  return (
    <div className={isDarkMode ? "dark" : ""}>
      <div className="h-screen max-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 flex flex-col max-w-md mx-auto relative overflow-hidden font-sans transition-colors duration-300">
        
        {/* Top Header Panel */}
        {!isJackpotTheaterMode && (
          <header className="flex justify-between items-center px-4 py-2 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shrink-0 transition-colors duration-300 z-40 fixed top-0 left-0 right-0 max-w-md mx-auto">
            {/* Top-Left: Wallet Balance Button (Click to open Wallet drawer) */}
            <button
              onClick={() => setIsWalletOpen(true)}
              className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 dark:bg-yellow-500/5 dark:hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 px-3 py-1 rounded-full text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              <Coins className="w-3.5 h-3.5 text-yellow-500" />
              <span className="font-mono font-black">{balance.toLocaleString()}</span>
            </button>

            {/* Center: Timer / Live Status (shown for even/odd page only) */}
            <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center justify-center">
              {activeTab === 'even_odd' && roomState?.status !== 'spinning' && roomState?.status !== 'result' && (
                <div className="flex items-center gap-1 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 rounded-full border border-blue-100 dark:border-blue-900/50 animate-in fade-in duration-300">
                  <Clock className="w-3 h-3 text-blue-500 animate-pulse" />
                  <span className={`font-mono text-sm font-black tracking-tight ${roomState?.timeLeft && roomState.timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-blue-600 dark:text-blue-400'}`}>
                    00:{roomState?.timeLeft.toString().padStart(2, '0') || '00'}
                  </span>
                </div>
              )}
            </div>

            {/* Top-Right: Live counting badge & Profile */}
            <div className="flex items-center gap-2">
              {roomState?.status !== 'spinning' && roomState?.status !== 'result' ? (
                <button 
                  id="players-portal-btn-top"
                  onClick={() => setIsPlayersDrawerOpen(true)}
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer animate-in fade-in duration-300"
                >
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <Users className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                  <span className="font-mono tracking-tight font-bold">{totalActivePlayersCount}</span>
                </button>
              ) : (
                <div className="w-[60px]" />
              )}
              
              {/* Profile Icon Button */}
              <button
                onClick={() => setActiveTab('profile')}
                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 transition-all active:scale-95 cursor-pointer"
              >
                <User className="w-4 h-4" />
              </button>
            </div>
          </header>
        )}

        {/* Global Notifications Handler */}
        {notification && (
          <div className={`absolute left-4 right-4 z-[100] animate-in fade-in slide-in-from-top-4 duration-300 ${isJackpotTheaterMode ? 'top-4' : 'top-16'}`}>
            <div className={`rounded-xl px-4 py-3 shadow-lg flex items-center gap-2 border text-sm font-semibold transition-all duration-300 ${
              notification.type === 'success' 
                ? 'bg-green-50 text-green-900 border-green-200 dark:bg-green-950/40 dark:text-green-100 dark:border-green-900/50' 
                : notification.type === 'error'
                ? 'bg-red-50 text-red-900 border-red-200 dark:bg-red-950/40 dark:text-red-100 dark:border-red-900/50'
                : 'bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-950/40 dark:text-blue-100 dark:border-blue-900/50'
            }`}>
              <AlertCircle className={`w-4 h-4 shrink-0 ${
                notification.type === 'success' ? 'text-green-500' : notification.type === 'error' ? 'text-red-500' : 'text-blue-500'
              }`} />
              <span className="flex-1">{notification.message}</span>
              <button onClick={() => setNotification(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-bold ml-2">×</button>
            </div>
          </div>
        )}

        {/* Scrollable Main Content Frame */}
        <main className={`flex-1 overflow-y-auto relative z-10 flex flex-col px-4 transition-all duration-300 ${isJackpotTheaterMode ? 'pt-4 pb-4' : 'pt-[52px] pb-[62px]'}`}>
          <AnimatePresence mode="wait">
            
            {/* TAB 1: Game Arena (Even/Odd) */}
            {activeTab === 'even_odd' && (
              <motion.div
                key="even_odd_tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col justify-between py-4"
              >
                {/* Wheel Canvas & Quick Arena Label */}
                <div className="relative mx-auto flex flex-col items-center my-auto">
                  <Wheel status={roomState?.status || 'betting'} winner={roomState?.winner} soundTicks={soundTicks} />
                </div>

                {/* Result Announcement Overlay */}
                {showResult && roomState?.winner && (
                  <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-50 flex items-center justify-center p-4">
                    <div className="bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 text-center shadow-2xl max-w-xs mx-auto animate-in zoom-in duration-300 backdrop-blur-md">
                      <div className="text-4xl mb-2">🎉</div>
                      <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Winner Number Is:</h2>
                      <div className="text-5xl font-black text-gray-900 dark:text-white my-3 animate-bounce tracking-tight font-mono">
                        {roomState.winner}
                      </div>
                      <div className={`text-sm font-black uppercase px-6 py-2.5 rounded-full inline-block text-white tracking-wider ${roomState.winner % 2 === 0 ? 'bg-red-500 shadow-md shadow-red-500/20' : 'bg-blue-500 shadow-md shadow-blue-500/20'}`}>
                        {roomState.winner % 2 === 0 ? 'ሞላ (EVEN)' : 'ጎደል (ODD)'} WINS!
                      </div>
                    </div>
                  </div>
                )}

                {/* Betting controls dashboard */}
                <div className="px-4 space-y-4 mt-auto">
                  {/* Shortcut Amounts Grid */}
                  <div className="flex gap-2 justify-center">
                    {[1000, 2000, 5000, 10000].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setBetAmount(amt)}
                        className={`px-3 py-2 rounded-xl text-xs font-black transition-all transform active:scale-95 flex-1 ${
                          betAmount === amt 
                            ? 'bg-yellow-500 text-black shadow-sm font-bold scale-[1.02]' 
                            : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {amt >= 1000 ? `${amt/1000}k` : amt}
                      </button>
                    ))}
                  </div>

                  {/* Input and Partial Bet options row */}
                  <div className="flex gap-2">
                    {/* Bet Amount Input */}
                    <div className="flex flex-1 bg-white/40 dark:bg-gray-900/40 rounded-xl p-0.5 border border-gray-200 dark:border-gray-800 transition-all duration-300 items-center relative overflow-hidden">
                      <div className={`absolute inset-0 bg-white/60 dark:bg-gray-900/60 transition-all duration-300 -z-10 ${!isInputFocused ? 'backdrop-blur-[2px]' : 'backdrop-blur-none'}`} />
                      <input
                        type="number"
                        min="10"
                        step="10"
                        value={betAmount || ''}
                        onFocus={() => setIsInputFocused(true)}
                        onBlur={() => setIsInputFocused(false)}
                        onChange={(e) => setBetAmount(Math.max(0, parseInt(e.target.value) || 0))}
                        className="bg-transparent text-gray-800 dark:text-gray-200 px-3 py-1.5 text-center font-bold text-sm outline-none w-full transition-colors placeholder:text-gray-400 dark:placeholder:text-gray-600 z-10"
                        placeholder="Custom Amount"
                      />
                    </div>

                    {/* Partial Bet toggle Switch */}
                    <div className="flex justify-between items-center bg-white dark:bg-gray-900 rounded-xl px-3 py-1 border border-gray-200 dark:border-gray-800 transition-colors shrink-0 gap-2">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Partial</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" checked={partialBet} onChange={e => setPartialBet(e.target.checked)} className="sr-only peer" />
                        <div className="w-8 h-4.5 bg-gray-300 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>

                  {/* Failed Bet Retry Banner helper */}
                  {failedBet && (
                    <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-3 text-sm text-red-800 dark:text-red-200 animate-in fade-in duration-300">
                      <div className="flex items-center gap-1.5 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                        <span>Bet of <strong>{failedBet.amount}</strong> failed.</span>
                      </div>
                      <button 
                        onClick={() => handlePlaceBet(failedBet.side, failedBet.amount)}
                        className="bg-red-600 hover:bg-red-500 text-white font-black px-2.5 py-1 rounded-lg text-[10px] transition-colors shadow-sm cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  {/* Placement Actions: EVEN and ODD */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => handlePlaceBet('even')}
                      disabled={roomState?.status !== 'betting' || isSoftClosed}
                      className={`flex-1 font-black py-3.5 rounded-xl active:shadow-none active:translate-y-[2px] transition-all text-base uppercase tracking-wider flex flex-col items-center justify-center ${
                        pulseSide === 'even' ? 'scale-95 brightness-150' : ''
                      } ${
                        roomState?.players[userId]?.side === 'even'
                          ? 'bg-red-500 shadow-none translate-y-[2px] ring-2 ring-white dark:ring-gray-950 ring-offset-2 ring-offset-red-500'
                          : 'bg-red-600 hover:bg-red-500 shadow-[0_4px_0_rgb(185,28,28)]'
                      } disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer`}
                    >
                      <span>ሞላ (Even)</span>
                      {roomState?.players[userId]?.side === 'even' && (
                        <span className="text-[10px] font-black mt-0.5 bg-black/30 px-2 py-0.5 rounded-full">
                          {roomState.players[userId].amount.toLocaleString()} Bet
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => handlePlaceBet('odd')}
                      disabled={roomState?.status !== 'betting' || isSoftClosed}
                      className={`flex-1 font-black py-3.5 rounded-xl active:shadow-none active:translate-y-[2px] transition-all text-base uppercase tracking-wider flex flex-col items-center justify-center ${
                        pulseSide === 'odd' ? 'scale-95 brightness-150' : ''
                      } ${
                        roomState?.players[userId]?.side === 'odd'
                          ? 'bg-blue-500 shadow-none translate-y-[2px] ring-2 ring-white dark:ring-gray-950 ring-offset-2 ring-offset-blue-500'
                          : 'bg-blue-600 hover:bg-blue-500 shadow-[0_4px_0_rgb(29,78,216)]'
                      } disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer`}
                    >
                      <span>ጎደል (Odd)</span>
                      {roomState?.players[userId]?.side === 'odd' && (
                        <span className="text-[10px] font-black mt-0.5 bg-black/30 px-2 py-0.5 rounded-full">
                          {roomState.players[userId].amount.toLocaleString()} Bet
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Recent round mini list */}
                  {history.length > 0 && (
                    <div className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 transition-colors">
                      <div className="flex justify-between items-center mb-1.5">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-wider flex items-center gap-1">
                          <History className="w-3 h-3" /> Recent History
                        </h3>
                        <span className="text-[9px] font-semibold text-gray-400">Showing last 5</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5">
                        {history.slice(0, 5).map((h) => (
                          <div 
                            key={h.roundId} 
                            className={`flex flex-col items-center justify-center py-1.5 rounded-lg border text-center transition-all ${
                              h.winner % 2 === 0 
                                ? 'bg-red-500/5 dark:bg-red-950/15 border-red-200 dark:border-red-900/45 text-red-600 dark:text-red-400' 
                                : 'bg-blue-50/10 dark:bg-blue-950/15 border-blue-200 dark:border-blue-900/45 text-blue-600 dark:text-blue-400'
                            }`}
                          >
                            <span className="text-xs font-black font-mono">{h.winner}</span>
                            <span className="text-[8px] font-black uppercase tracking-tighter opacity-80 mt-0.5">
                              {h.winner % 2 === 0 ? 'ሞላ' : 'ጎደል'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* TAB 1.5: High-Stakes Jackpot Systems */}
            {activeTab === 'jackpot' && (
              <motion.div
                key="jackpot_tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col"
              >
                <JackpotArena
                  balance={balance}
                  setBalance={setBalance}
                  showNotification={showNotification}
                  setMockTransactions={setMockTransactions}
                  isDarkMode={isDarkMode}
                  soundTicks={soundTicks}
                  onTheaterModeChange={setIsJackpotTheaterMode}
                />
              </motion.div>
            )}

            {/* TAB 2: P2P Wheel of Chance Page (Ultra-Clean UI/UX Spec) */}
            {activeTab === 'chance' && (
              <motion.div
                key="chance_tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex flex-col"
              >
                <WheelOfChance
                  balance={balance}
                  setBalance={setBalance}
                  setMockTransactions={setMockTransactions}
                  isDarkMode={isDarkMode}
                  soundTicks={soundTicks}
                  onBack={() => setActiveTab('even_odd')}
                />
              </motion.div>
            )}



            {/* TAB 4: Profile Page */}
            {activeTab === 'profile' && (
              <motion.div
                key="profile_tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="flex-1 p-4 space-y-4"
              >
                {/* User Info Card */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors text-center shadow-xs">
                  <div className="relative mx-auto w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center font-bold text-2xl text-white shadow-md">
                    {username.charAt(0).toUpperCase()}
                    <div className="absolute -bottom-1 -right-1 bg-green-500 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900" />
                  </div>
                  <h2 className="text-base font-black text-gray-900 dark:text-white mt-3">{username}</h2>
                  
                  {/* Account id and quick copy button */}
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <span className="text-[10px] font-bold text-gray-400 font-mono">ID: {userId.slice(5, 18).toUpperCase()}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(userId);
                        setCopiedId(true);
                        setTimeout(() => setCopiedId(false), 2000);
                      }}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors text-gray-400 hover:text-gray-600"
                    >
                      {copiedId ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>

                  {/* Small Profile Stats Row */}
                  <div className="grid grid-cols-2 gap-2 mt-4 bg-gray-50 dark:bg-gray-950/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800/60 text-center">
                    <div>
                      <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Matches Spin</div>
                      <div className="text-sm font-black text-gray-800 dark:text-gray-200">92</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Accrued Wins</div>
                      <div className="text-sm font-black text-green-500">54.3%</div>
                    </div>
                  </div>
                </div>

                {/* Profile Controls (Settings & Switches migrated here!) */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs space-y-3">
                  <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1.5">Game Settings</h3>
                  
                  {/* Theme Switcher Row */}
                  <div className="flex justify-between items-center py-1">
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Visual Dark Mode</span>
                    <button 
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
                    >
                      {isDarkMode ? (
                        <span className="flex items-center gap-1.5 text-xs font-black">
                          <Sun className="w-3.5 h-3.5 text-yellow-500" /> Sun Theme
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs font-black">
                          <Moon className="w-3.5 h-3.5 text-blue-500" /> Dark Theme
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Sound Ticks switch */}
                  <div className="flex justify-between items-center py-1 border-t border-gray-100 dark:border-gray-800/40">
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Wheel Ticks Audio</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={soundTicks} onChange={e => setSoundTicks(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-300 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Win/Loss alert switch */}
                  <div className="flex justify-between items-center py-1 border-t border-gray-100 dark:border-gray-800/40">
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Win/Loss Alerts Sound</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={soundAlerts} onChange={e => setSoundAlerts(e.target.checked)} className="sr-only peer" />
                      <div className="w-9 h-5 bg-gray-300 dark:bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>

                {/* Helpful Guide / Onboarding Tutorial access */}
                <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs">
                  <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">Tutorial Guide</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                    Want to learn how the game mechanics works or read about shortcut key bindings? Open the helper popup tutorial below.
                  </p>
                  <button 
                    onClick={() => setShowOnboarding(true)}
                    className="w-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-blue-200/50 dark:border-blue-900/50"
                  >
                    <HelpCircle className="w-4 h-4" /> Open How to Play Tutorial
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </main>

        {/* Modern Bottom Tabbed Menu Bar */}
        {!isJackpotTheaterMode && (
          <nav id="bottom-navigation-bar" className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-t border-gray-200 dark:border-gray-800 flex justify-around items-center py-1.5 px-1 z-40 transition-colors duration-300 shadow-lg shrink-0 max-w-md mx-auto">
            <button
              onClick={() => setActiveTab('even_odd')}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'even_odd' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Gamepad2 className="w-5 h-5" />
              <span className="text-[9px] tracking-tight font-black uppercase">Arena</span>
            </button>

            <button
              onClick={() => setActiveTab('jackpot')}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'jackpot' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <Trophy className="w-5 h-5" />
              <span className="text-[9px] tracking-tight font-black uppercase">Jackpot</span>
            </button>

            <button
              onClick={() => setActiveTab('chance')}
              className={`flex flex-col items-center gap-0.5 flex-1 py-0.5 transition-all cursor-pointer ${
                activeTab === 'chance' 
                  ? 'text-blue-600 dark:text-blue-400 scale-105 font-black' 
                  : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <TrendingUp className="w-5 h-5" />
              <span className="text-[9px] tracking-tight font-black uppercase">Chance</span>
            </button>
          </nav>
        )}

      </div>

      {/* Onboarding Dialog modal */}
      {showOnboarding && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 p-4">
          <div className="bg-white dark:bg-gray-900 w-full max-w-xs rounded-2xl p-5 shadow-2xl border border-gray-200 dark:border-gray-800">
            <h2 className="text-lg font-black text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-blue-500" /> Welcome to Wheel Bet!
            </h2>
            <div className="space-y-3 text-gray-700 dark:text-gray-300 text-xs leading-relaxed">
              <p>
                <strong>Even (ሞላ):</strong> Bet that the wheel lands on an even number (2, 4, 6).<br/>
                <strong>Odd (ጎደል):</strong> Bet that the wheel lands on an odd number (1, 3, 5).
              </p>
              <p>
                <strong>Custom Amounts:</strong> Type any amount or use keys <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">1</kbd>, <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">2</kbd>, <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">5</kbd>, <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">0</kbd> to quick-select 1k, 2k, 5k, 10k.
              </p>
              <p>
                <strong>Quick Play:</strong> Press <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">Enter</kbd> to quickly place a bet on Even, or press <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">E</kbd> for Even / <kbd className="bg-gray-200 dark:bg-gray-800 px-1.5 py-0.5 rounded">O</kbd> for Odd.
              </p>
            </div>
            
            <button onClick={() => {
              setShowOnboarding(false);
              localStorage.setItem('onboardingSeen', 'true');
            }} className="w-full mt-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs transition-colors cursor-pointer">
              Got it, let's play!
            </button>
          </div>
        </div>
      )}

      {/* Wallet Portal Drawer */}
      <AnimatePresence>
        {isWalletOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsWalletOpen(false)}
              className="absolute inset-0 z-[80] bg-black/60 backdrop-blur-xs transition-opacity"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 h-[80vh] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 rounded-t-[2.5rem] shadow-2xl z-[90] flex flex-col overflow-hidden transition-colors duration-300"
            >
              {/* Native Grab Indicator */}
              <div className="mx-auto my-3 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full cursor-pointer hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors" onClick={() => setIsWalletOpen(false)} />

              {/* Drawer Header */}
              <div className="px-5 pb-3 pt-1 border-b border-gray-100 dark:border-gray-800/80 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-yellow-500 animate-pulse" />
                  <div>
                    <h2 className="text-base font-black text-gray-900 dark:text-white leading-tight font-sans">Interactive Wallet Ledger</h2>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-500">Deposit & Withdrawal Sandbox</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsWalletOpen(false)} 
                  className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-12">
                {/* Credit Card-Style Wallet Balance display */}
                <div className="relative overflow-hidden bg-gradient-to-tr from-yellow-500 via-amber-600 to-amber-700 rounded-2xl p-6 text-white shadow-xl">
                  {/* Background Accents */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl -mr-6 -mt-6" />
                  <div className="absolute bottom-0 left-0 w-16 h-16 bg-black/10 rounded-full blur-xl -ml-4 -mb-4" />
                  
                  <div className="flex justify-between items-start z-10 relative">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest opacity-80">Interactive Ledger</div>
                      <h2 className="text-2xl font-black mt-1 font-mono tracking-tight">{balance.toLocaleString()}</h2>
                      <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full inline-block mt-1 font-bold">ETHIO COINS</span>
                    </div>
                    <Coins className="w-8 h-8 opacity-40 animate-pulse shrink-0" />
                  </div>

                  <div className="mt-8 flex justify-between items-center z-10 relative text-[10px] opacity-90 font-mono">
                    <div>
                      <span className="block opacity-60">ACCOUNT IDENTIFIER</span>
                      <span className="font-bold">USR_{userId.slice(5, 12).toUpperCase()}</span>
                    </div>
                    <div className="text-right">
                      <span className="block opacity-60">STATUS</span>
                      <span className="font-bold tracking-widest">ACTIVE VIP</span>
                    </div>
                  </div>
                </div>

                {/* Deposit and Withdrawal Simulated Panels */}
                <div className="bg-gray-50 dark:bg-gray-950 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs space-y-4">
                  {/* Quick deposit simulator */}
                  <div>
                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider flex items-center gap-1.5 mb-2 flex">
                      <ArrowDownLeft className="w-4 h-4 text-green-500 mr-1" /> Simulated Deposit Sandbox
                    </h3>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Amount to deposit"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        className="flex-1 bg-white dark:bg-gray-900 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      />
                      <button
                        onClick={() => {
                          const amt = parseInt(depositAmount);
                          if (amt > 0) {
                            setBalance(prev => prev + amt);
                            setMockTransactions(prev => [
                              { id: Date.now(), type: 'reward', desc: 'Simulated Sandbox Deposit', amount: amt, date: 'Just now', positive: true },
                              ...prev
                            ]);
                            showNotification(`Deposited ${amt.toLocaleString()} Simulated Coins!`, 'success');
                            confetti({ particleCount: 30, spread: 40, origin: { y: 0.8 } });
                          }
                        }}
                        className="bg-green-600 hover:bg-green-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" /> Deposit
                      </button>
                    </div>
                  </div>

                  {/* Cashout/withdrawal panel */}
                  <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider flex items-center gap-1.5 mb-2 flex">
                      <ArrowUpRight className="w-4 h-4 text-red-500 mr-1" /> Automated Tele/E-Birr Withdrawal
                    </h3>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Telegram username (e.g. @tele_birr_user)"
                        value={withdrawHandle}
                        onChange={(e) => setWithdrawHandle(e.target.value)}
                        className="w-full bg-white dark:bg-gray-900 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Withdraw amount"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          className="flex-1 bg-white dark:bg-gray-900 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100"
                        />
                        <button
                          onClick={() => {
                            const amt = parseInt(withdrawAmount);
                            if (isNaN(amt) || amt <= 0) {
                              showNotification("Please specify a valid withdrawal amount.", "error");
                              return;
                            }
                            if (balance < amt) {
                              showNotification("Insufficient balance for withdrawal!", "error");
                              return;
                            }
                            if (!withdrawHandle.trim()) {
                              showNotification("Please specify your Telegram Username first.", "error");
                              return;
                            }
                            setBalance(prev => prev - amt);
                            setMockTransactions(prev => [
                              { id: Date.now(), type: 'bet', desc: `Simulated Cashout (${withdrawHandle})`, amount: -amt, date: 'Just now', positive: false },
                              ...prev
                            ]);
                            showNotification(`Withdrawal of ${amt.toLocaleString()} submitted successfully!`, 'success');
                          }}
                          className="bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-2 rounded-xl text-xs flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ledger Tabs Segmented Control */}
                <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl flex gap-1 mb-4 shadow-inner">
                  <button
                    onClick={() => setLedgerTab('play')}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                      ledgerTab === 'play' 
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' 
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer'
                    }`}
                  >
                    Play History
                  </button>
                  <button
                    onClick={() => setLedgerTab('transactions')}
                    className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${
                      ledgerTab === 'transactions' 
                        ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' 
                        : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer'
                    }`}
                  >
                    Transactions
                  </button>
                </div>

                {ledgerTab === 'transactions' ? (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs">
                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider mb-2 flex items-center gap-1.5 flex">
                      <History className="w-4 h-4 mr-1" /> Transaction History
                    </h3>
                    <div className="space-y-2 divide-y divide-gray-100 dark:divide-gray-800/40">
                      {mockTransactions.map((tx) => (
                        <div key={tx.id} className="flex justify-between items-center pt-2.5 first:pt-0">
                          <div>
                            <div className="text-xs font-bold text-gray-800 dark:text-gray-200">{tx.desc}</div>
                            <div className="text-[10px] text-gray-400 font-medium mt-0.5">{tx.date}</div>
                          </div>
                          <span className={`text-xs font-black font-mono ${tx.positive ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                            {tx.positive ? '+' : ''}{tx.amount.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 border border-gray-200 dark:border-gray-800 transition-colors shadow-xs">
                    <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider mb-2 flex items-center gap-1.5 flex">
                      <TrendingUp className="w-4 h-4 mr-1" /> Play History
                    </h3>
                    <div className="space-y-3">
                      {gameHistory.map((log) => (
                        <div key={log.id} className="bg-gray-50 dark:bg-gray-950 border border-gray-100 dark:border-gray-800/50 rounded-xl p-3 shadow-xs flex justify-between items-center">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-black uppercase text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                                {log.type}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono font-bold">{log.id}</span>
                            </div>
                            <div className="text-xs font-bold text-gray-700 dark:text-gray-300">
                              Bet: {log.bet.toLocaleString()} ETB <span className="text-gray-400 mx-1">•</span> Choice: {log.numbers}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              {log.date}
                            </div>
                          </div>
                          
                          <div className="text-right flex flex-col items-end">
                            <div className={`text-xs font-black uppercase tracking-wider mb-0.5 ${
                              log.result === 'Loss' ? 'text-gray-500' : 'text-green-500 animate-pulse'
                            }`}>
                              {log.result}
                            </div>
                            <div className={`text-sm font-mono font-black ${
                              log.change > 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {log.change > 0 ? '+' : ''}{log.change.toLocaleString()}
                            </div>
                            <div className="text-[9px] font-bold text-gray-400 mt-1 uppercase">{log.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Active Players Portal - Simplified VIP Lobby Bottom Sheet Drawer */}
      <AnimatePresence>
        {isPlayersDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPlayersDrawerOpen(false)}
              className="absolute inset-0 z-[80] bg-black/60 backdrop-blur-xs transition-opacity"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="absolute bottom-0 left-0 right-0 h-[75vh] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 rounded-t-[2.5rem] shadow-2xl z-[90] flex flex-col overflow-hidden transition-colors duration-300"
            >
              {/* Native Grab Indicator */}
              <div className="mx-auto my-3 w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full cursor-pointer hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors" onClick={() => setIsPlayersDrawerOpen(false)} />

              {/* Drawer Header */}
              <div className="px-5 pb-3 pt-1 border-b border-gray-100 dark:border-gray-800/80">
                <div className="flex justify-between items-center mb-1">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-500 animate-pulse" />
                    <div>
                      <h2 className="text-base font-black text-gray-900 dark:text-white leading-tight">VIP Lobby Portal</h2>
                      <p className="text-[9px] font-bold uppercase tracking-wider text-blue-500">First 100 Early placements</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsPlayersDrawerOpen(false)} 
                    className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Search Bar */}
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search player username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-100 dark:bg-gray-950 pl-9 pr-4 py-2 rounded-xl text-xs border-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-600 transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-bold text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Player List */}
              <div className="flex-1 overflow-y-auto px-5 py-3 divide-y divide-gray-100 dark:divide-gray-800/40">
                {vipPlayersList.filter(p => p.username.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                  <div className="text-center py-10 text-gray-400 dark:text-gray-600 text-sm">
                    No early-joining players found matching "{searchQuery}"
                  </div>
                ) : (
                  vipPlayersList
                    .filter(p => p.username.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((player, index) => {
                      const isCurrentUser = player.id === userId;
                      return (
                        <div key={player.id} className={`flex items-center justify-between py-2.5 transition-colors ${isCurrentUser ? 'bg-blue-50/40 dark:bg-blue-950/10 px-2 rounded-xl border border-blue-100/30 dark:border-blue-900/10' : ''}`}>
                          <div className="flex items-center gap-2.5">
                            {/* Rank Badge */}
                            <span className="font-mono text-xs font-bold text-gray-400 dark:text-gray-500 w-5 shrink-0">
                              #{index + 1}
                            </span>

                            {/* Avatar with initials */}
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white relative shrink-0 ${
                              player.side === 'even' 
                                ? 'bg-gradient-to-tr from-red-600 to-red-400' 
                                : 'bg-gradient-to-tr from-blue-600 to-blue-400'
                            }`}>
                              {player.username.replace('@', '').charAt(0).toUpperCase()}
                              {player.isReal && (
                                <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-green-500 border-2 border-white dark:border-gray-900" />
                              )}
                            </div>

                            {/* Player Name & Tag */}
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-xs font-bold ${isCurrentUser ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                                  {player.username}
                                </span>
                                {isCurrentUser && (
                                  <span className="text-[8px] bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 font-black px-1.5 py-0.5 rounded-md">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[9px] text-gray-400 font-semibold uppercase">{player.badge}</span>
                                <span className="text-[9px] text-gray-300 dark:text-gray-700">•</span>
                                <span className="text-[9px] text-gray-400 font-mono">{player.joinTime}</span>
                              </div>
                            </div>
                          </div>

                          {/* Player Bet Details (Omit their exact side choice Even/Odd as requested!) */}
                          <div className="text-right">
                            <div className="text-xs font-black text-yellow-600 dark:text-yellow-400 flex items-center justify-end gap-0.5">
                              <Coins className="w-3.5 h-3.5 shrink-0" />
                              {player.amount.toLocaleString()}
                            </div>
                            <div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                              WAGERED
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
              
              {/* Footer status bar */}
              <div className="bg-gray-50 dark:bg-gray-950 p-3 text-center border-t border-gray-100 dark:border-gray-800/60 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                🔒 Sealed Rounds VIP Registry
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
