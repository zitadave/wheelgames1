import React, { useState, useEffect, useRef } from 'react';
import { Trophy, Coins, Lock, Sparkles, RefreshCw, AlertTriangle, Zap, Flame, Crown, Eye, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OdometerCanvas } from './OdometerCanvas';

interface JackpotArenaProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  setGameHistory: React.Dispatch<React.SetStateAction<any[]>>;
  isDarkMode: boolean;
  soundTicks: boolean;
  onTheaterModeChange?: (active: boolean) => void;
  onBack?: () => void;
  socket?: any;
  userId?: string;
}

type JackpotTier = 'mini' | 'grand';

interface JackpotHistoryItem {
  roundId: number;
  winners: { 1?: number; 2?: number; 3?: number };
}

interface Participant {
  username: string;
  isSelf: boolean;
}

export function JackpotArena({
  balance,
  setBalance,
  showNotification,
  setTransactions,
  setGameHistory,
  isDarkMode,
  soundTicks,
  onTheaterModeChange,
  onBack,
  socket,
  userId
}: JackpotArenaProps) {
  const [tier, setTier] = useState<JackpotTier>('mini');
  
  // Matrix configurations
  const config = {
    mini: { slots: 50, entry: 2000, gross: 100000, fee: 10000, p1: 72000, p2: 12600, p3: 5400 },
    grand: { slots: 100, entry: 2000, gross: 200000, fee: 20000, p1: 144000, p2: 25200, p3: 10800 }
  };

  const currentConfig = config[tier];

  // Grid spots state
  const [miniGrid, setMiniGrid] = useState<Record<number, Participant>>({});
  const [grandGrid, setGrandGrid] = useState<Record<number, Participant>>({});

  // Game phases:
  // 'lobby' -> 'freeze' -> 'drawing' -> 'winner' -> 'vaporizing' -> 'complete'
  const [gamePhase, setGamePhase] = useState<'lobby' | 'freeze' | 'drawing' | 'winner' | 'vaporizing' | 'complete'>('lobby');
  
  // Track currently drawn winners for the 3 slots (1st, 2nd, 3rd)
  const [drawNumber, setDrawNumber] = useState<1 | 2 | 3>(1);
  const [winners, setWinners] = useState<{ first?: number; second?: number; third?: number }>({});
  const [vaporizedSlots, setVaporizedSlots] = useState<number[]>([]);

  const [roundIds, setRoundIds] = useState<{ mini: number; grand: number }>(() => ({
    mini: Math.floor(Math.random() * 9000) + 1000,
    grand: Math.floor(Math.random() * 9000) + 1000
  }));
  const [history, setHistory] = useState<{ mini: JackpotHistoryItem[]; grand: JackpotHistoryItem[] }>({
    mini: [],
    grand: []
  });

  const currentRoundId = roundIds[tier];
  const currentHistory = history[tier];

  // Animation States
  const [freezeCountdown, setFreezeCountdown] = useState<number>(10);
  
  // Neon Blitz dynamic active index
  const [blitzActiveTile, setBlitzActiveTile] = useState<number | null>(null);
  const isMounted = useRef<boolean>(true);
  // Timer management to prevent memory leaks/stuck state on unmount
  const activeTimers = useRef<NodeJS.Timeout[]>([]);
  const clearAllTimers = () => {
    activeTimers.current.forEach(timer => clearTimeout(timer));
    activeTimers.current = [];
  };

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      clearAllTimers();
    };
  }, []);

  // Wrap setTimeout to track it
  const trackTimeout = (fn: Function, delay: number) => {
    const id = setTimeout(() => {
      if (!isMounted.current) return;
      fn();
      activeTimers.current = activeTimers.current.filter(t => t !== id);
    }, delay);
    activeTimers.current.push(id);
    return id;
  };

  // Wrap setInterval to track it
  const trackInterval = (fn: Function, delay: number) => {
    const id = setInterval(() => {
      if (!isMounted.current) {
        clearInterval(id);
        return;
      }
      fn();
    }, delay);
    activeTimers.current.push(id as unknown as NodeJS.Timeout);
    return id;
  };

  // Current winner selected to spin
  const [currentWinner, setCurrentWinner] = useState<number | null>(null);

  // VIP Grand Reels digits
  const [reelHundred, setReelHundred] = useState<string>('0');
  const [reelTen, setReelTen] = useState<string>('0');
  const [reelOne, setReelOne] = useState<string>('0');
  const [hundredsSpinning, setHundredsSpinning] = useState(false);
  const [tensSpinning, setTensSpinning] = useState(false);
  const [onesSpinning, setOnesSpinning] = useState(false);

  // Active grid alias
  const activeGrid = tier === 'mini' ? miniGrid : grandGrid;
  const setTargetGrid = tier === 'mini' ? setMiniGrid : setGrandGrid;

  // Sync theater mode status up to parent
  const lastTheaterModeRef = useRef<boolean>(false);
  useEffect(() => {
    const isTheater =
      gamePhase === 'drawing' ||
      gamePhase === 'winner' ||
      gamePhase === 'vaporizing' ||
      gamePhase === 'complete';

    if (onTheaterModeChange && lastTheaterModeRef.current !== isTheater) {
      lastTheaterModeRef.current = isTheater;
      onTheaterModeChange(isTheater);
    }
  }, [gamePhase, onTheaterModeChange]);

  useEffect(() => {
    return () => {
      if (onTheaterModeChange && lastTheaterModeRef.current) {
        onTheaterModeChange(false);
      }
    };
  }, [onTheaterModeChange]);

  // Sound generator
  const playHapticAudio = (freq = 600) => {
    if (!soundTicks || !isMounted.current) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.04);
    } catch (e) {}
  };

  const playWinnerAudio = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(850, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch (e) {}
  };

  // Populate grids initially with 65% filled and recover interrupted phase
  useEffect(() => {
    const savedState = sessionStorage.getItem('jackpotArenaState');
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        setGamePhase(state.gamePhase);
        setDrawNumber(state.drawNumber);
        setWinners(state.winners);
        setVaporizedSlots(state.vaporizedSlots);
        if (state.tier === 'mini') {
          setMiniGrid(state.grid);
        } else {
          setGrandGrid(state.grid);
        }
        setTier(state.tier);

        // Safely recover active draw phase on mount
        if (state.gamePhase !== 'lobby') {
          if (state.gamePhase === 'drawing') {
            executeSequentialDraw(state.drawNumber);
          } else if (state.gamePhase === 'winner' || state.gamePhase === 'vaporizing') {
            if (state.drawNumber < 3) {
              executeSequentialDraw((state.drawNumber + 1) as 2 | 3);
            } else {
              setGamePhase('complete');
              trackTimeout(() => resetLobby(), 6000);
            }
          } else if (state.gamePhase === 'complete') {
            trackTimeout(() => resetLobby(), 6000);
          }
        }
      } catch (e) {
        resetLobby();
      }
    } else {
      resetLobby();
    }
  }, []);

  // Persist state
  useEffect(() => {
    sessionStorage.setItem('jackpotArenaState', JSON.stringify({
      gamePhase,
      drawNumber,
      winners,
      vaporizedSlots,
      grid: activeGrid,
      tier
    }));
  }, [gamePhase, drawNumber, winners, vaporizedSlots, activeGrid, tier]);

  const resetLobby = () => {
    sessionStorage.removeItem('odometerStartTime');
    sessionStorage.removeItem('jackpotArenaState');
    setTargetGrid({});
    setGamePhase('lobby');
    setDrawNumber(1);
    setWinners({});
    setVaporizedSlots([]);
    setBlitzActiveTile(null);
    setReelHundred('0');
    setReelTen('0');
    setReelOne('0');
    setRoundIds(prev => ({ ...prev, [tier]: prev[tier] + 1 }));
  };

  const triggerGlobalFreeze = () => {
    setGamePhase('freeze');
    setFreezeCountdown(10);
  };

  // Countdown timer for freeze phase
  useEffect(() => {
    if (gamePhase !== 'freeze') return;
    if (freezeCountdown <= 0) {
      executeSequentialDraw(1);
      return;
    }

    const timer = trackTimeout(() => {
      setFreezeCountdown(prev => prev - 1);
      playHapticAudio(300);
    }, 1000);

    return () => clearTimeout(timer);
  }, [gamePhase, freezeCountdown]);

  // General Drawing Controller
  const executeSequentialDraw = (drawIndex: 1 | 2 | 3) => {
    setDrawNumber(drawIndex);
    setGamePhase('drawing');

    // Filter valid remaining slots
    const availableSpots: number[] = [];
    for (let i = 1; i <= currentConfig.slots; i++) {
      if (activeGrid[i] && !vaporizedSlots.includes(i) && !Object.values(winners).includes(i)) {
        availableSpots.push(i);
      }
    }

    // fallback
    if (availableSpots.length === 0) {
      availableSpots.push(Math.floor(Math.random() * currentConfig.slots) + 1);
    }

    const matchedWinner = availableSpots[Math.floor(Math.random() * availableSpots.length)];
    setCurrentWinner(matchedWinner);

    // Neon Lightning Blitz for mini, for grand we just start odometer immediately
    if (tier !== 'grand') {
      runNeonLightningBlitz(matchedWinner, drawIndex);
    } else {
      // Grand skips neon blitz
    }
  };

  // Neon Lightning Blitz loop
  const runNeonLightningBlitz = (finalWinner: number, drawIndex: 1 | 2 | 3) => {
    let currentDelay = 40; // Starts a bit slower
    const totalDuration = 20000; // 20s for all tiers
    const startTime = Date.now();

    // Create a list of available candidate coordinates for visual jumps
    const candidates = Array.from({ length: currentConfig.slots }, (_, i) => i + 1)
      .filter(num => activeGrid[num] && !vaporizedSlots.includes(num));

    const step = () => {
      if (!isMounted.current) return;
      const elapsed = Date.now() - startTime;
      
      // Suspenseful logic: initial build, mid-speed up, dramatic end slow down
      if (elapsed > totalDuration - 2500) {
        // Dramatic slow down at the end (last 2.5s)
        currentDelay = Math.min(currentDelay * 1.5, 1000);
      } else if (elapsed > totalDuration * 0.7) {
        // Slight acceleration in the middle for tension
        currentDelay = Math.max(currentDelay - 5, 20);
      } else {
        // Initial build-up
        currentDelay = Math.min(currentDelay + 2, 150);
      }

      // Select random candidate
      const nextTile = candidates[Math.floor(Math.random() * candidates.length)] || 1;
      setBlitzActiveTile(nextTile);
      playHapticAudio(500 + nextTile * 4); // sliding frequencies

      if (elapsed >= totalDuration) {
        // Lock and crown finalWinner visually
        setBlitzActiveTile(finalWinner);
        playHapticAudio(900);
        if (tier === 'mini') {
          trackTimeout(() => {
            finalizeDrawWinner(finalWinner, drawIndex);
          }, 1000);
        }
      } else {
        trackTimeout(step, currentDelay);
      }
    };

    trackTimeout(step, currentDelay);
  };

  // 3-Digit Mechanical Reels loop
  const runMechanicalReels = (finalWinner: number, drawIndex: 1 | 2 | 3) => {
    setHundredsSpinning(true);
    setTensSpinning(true);
    setOnesSpinning(true);

    // Calculate columns
    // Supports any 3-digit winner number up to 999
    const hDigit = finalWinner >= 100 ? Math.floor(finalWinner / 100).toString() : '0';
    const tDigit = Math.floor((finalWinner % 100) / 10).toString();
    const oDigit = (finalWinner % 10).toString();

    let spinsCount = 0;
    
    // Rapid reel shuffle interval (fast phase)
    const shuffleInterval = trackInterval(() => {
      if (hundredsSpinning) setReelHundred(Math.round(Math.random()).toString());
      if (tensSpinning) setReelTen(Math.floor(Math.random() * 10).toString());
      if (onesSpinning) setReelOne(Math.floor(Math.random() * 10).toString());
      playHapticAudio(400);
      spinsCount++;

      // Sequential slow down and locking
      if (spinsCount === 25) {
        // Lock Hundreds
        setHundredsSpinning(false);
        setReelHundred(hDigit);
        playHapticAudio(700);
      } else if (spinsCount === 42) {
        // Lock Tens
        setTensSpinning(false);
        setReelTen(tDigit);
        playHapticAudio(700);
      } else if (spinsCount === 60) {
        // Lock Ones
        clearInterval(shuffleInterval);
        setOnesSpinning(false);
        setReelOne(oDigit);
        playHapticAudio(900);

        // Announce winner
        trackTimeout(() => {
          finalizeDrawWinner(finalWinner, drawIndex);
        }, 500);
      }
    }, 90);
  };

  const finalizeDrawWinner = (winnerNum: number, drawIndex: 1 | 2 | 3) => {
    setWinners(prev => {
      const updated = { ...prev };
      if (drawIndex === 1) updated.first = winnerNum;
      else if (drawIndex === 2) updated.second = winnerNum;
      else updated.third = winnerNum;

      if (drawIndex === 3) {
        setHistory(h => {
          if (h[tier].some((x: any) => x.roundId === currentRoundId)) return h;
          return {
            ...h,
            [tier]: [
              { roundId: currentRoundId, winners: { 1: updated.first, 2: updated.second, 3: updated.third } },
              ...h[tier]
            ].slice(0, 10)
          };
        });
      }

      return updated;
    });

    setGamePhase('winner');
    playWinnerAudio();

    // Handle user payouts
    const isSelfWin = activeGrid[winnerNum]?.isSelf;
    if (isSelfWin) {
      let prize = 0;
      if (drawIndex === 1) prize = currentConfig.p1;
      else if (drawIndex === 2) prize = currentConfig.p2;
      else prize = currentConfig.p3;

      setBalance(prev => {
        const newBalance = prev + prize;
        socket?.emit('logGamePlay', { userId, gameType: 'Jackpot', result: `Won ${drawIndex}st Place`, winAmount: prize, newBalance });
        socket?.emit('logTransaction', { userId, amount: prize, type: 'win', description: `🏆 Jackpot ${drawIndex}st Place Win!`, newBalance });
        return newBalance;
      });
      setTransactions(prev => [
        { id: Date.now(), type: 'win', desc: `🏆 Jackpot ${drawIndex}st Place Win!`, amount: prize, date: 'Just now', positive: true },
        ...prev
      ]);
      setGameHistory(prev => [
        {
          id: `R#${currentRoundId}`,
          type: `Jackpot ${tier}`,
          bet: currentConfig.entry,
          numbers: winnerNum.toString(),
          date: new Date().toLocaleString(),
          result: `${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Win`,
          change: prize,
          status: 'Completed'
        },
        ...prev
      ]);
      showNotification(`🎉 Congratulations! You won the Jackpot ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Prize of ${prize.toLocaleString()} ETB!`, 'success');
    } else {
      const selfClaimed = Object.values(activeGrid).some((c: any) => c.isSelf);
      if (selfClaimed && drawIndex === 3) { // Only log miss on the 3rd draw for jackpot
           setGameHistory(prev => [
             {
               id: `R#${currentRoundId}`,
               type: `Jackpot ${tier}`,
               bet: currentConfig.entry,
               numbers: '-',
               date: new Date().toLocaleString(),
               result: 'Miss',
               change: 0,
               status: 'Completed'
             },
             ...prev
           ]);
      }
      showNotification(`Coordinate #${winnerNum} ([🔒 ${activeGrid[winnerNum]?.username || 'Player'}]) claims ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place!`, 'info');
    }

    // Wait 5 seconds, then vaporize this slot to proceed to the next slot draw
    trackTimeout(() => {
      setBlitzActiveTile(null);
      
      if (drawIndex < 3) {
        setGamePhase('vaporizing');
        setVaporizedSlots(prev => [...prev, winnerNum]);
        
        // Wait 2.5 seconds in vaporization phase, then proceed
        trackTimeout(() => {
          executeSequentialDraw((drawIndex + 1) as 2 | 3);
        }, 2200);
      } else {
        // Fully complete
        setGamePhase('complete');
        
        // Wait 6 seconds and restart the lobby
        trackTimeout(() => {
          resetLobby();
        }, 6000);
      }
    }, 5000);
  };

  const handleClaimSlot = (num: number) => {
    if (gamePhase !== 'lobby') {
      showNotification('Grid coordinates are currently locked for drawing!', 'error');
      return;
    }

    if (activeGrid[num]) {
      if (activeGrid[num].isSelf) {
        // Unclaim
        setBalance(prev => {
          const newBalance = prev + currentConfig.entry;
          socket?.emit('logTransaction', { userId, amount: currentConfig.entry, type: 'refund', description: `Refund Spot #${num}`, newBalance });
          return newBalance;
        });
        setTargetGrid(prev => {
          const next = { ...prev };
          delete next[num];
          return next;
        });
        showNotification(`Unsecured Grid Position #${num}!`, 'success');
      } else {
        showNotification('This position is already allocated!', 'error');
      }
      return;
    }

    if (balance < currentConfig.entry) {
      showNotification('Insufficient balance to claim this 2,000 ETB slot!', 'error');
      return;
    }

    setBalance(prev => {
      const newBalance = prev - currentConfig.entry;
      socket?.emit('logTransaction', { userId, amount: -currentConfig.entry, type: 'bet', description: `Secured Spot #${num} in Jackpot`, newBalance });
      return newBalance;
    });
    setTransactions(prev => [
      { id: Date.now(), type: 'bet', desc: `Secured Spot #${num} in Jackpot`, amount: -currentConfig.entry, date: 'Just now', positive: false },
      ...prev
    ]);

    setTargetGrid(prev => ({
      ...prev,
      [num]: {
        username: 'You',
        isSelf: true
      }
    }));

    showNotification(`Secured Grid Position #${num}! Good Luck!`, 'success');
  };

  const isTheaterActive = gamePhase === 'drawing' || gamePhase === 'winner' || gamePhase === 'vaporizing' || gamePhase === 'complete';

  return (
    <div className="flex-1 flex flex-col justify-start">
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-4 left-4 z-50 p-2 bg-zinc-800 rounded-full text-white"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      )}
      

      


      {/* Room Category Tabs */}
      {!isTheaterActive && (
        <>
          <div className="grid grid-cols-2 gap-2 bg-gray-200/60 dark:bg-gray-900/60 p-1 rounded-xl mb-4 shrink-0 border border-gray-300/40 dark:border-gray-800/40">
          <button
            onClick={() => gamePhase === 'lobby' && setTier('mini')}
            disabled={gamePhase !== 'lobby'}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tier === 'mini'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm font-black'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:dark:text-gray-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" /> Mini-VIP (1-50)
          </button>
          <button
            onClick={() => gamePhase === 'lobby' && setTier('grand')}
            disabled={gamePhase !== 'lobby'}
            className={`py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tier === 'grand'
                ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm font-black'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 hover:dark:text-gray-200'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Crown className="w-3.5 h-3.5 text-yellow-500" /> VIP Grand (1-100)
          </button>
        </div>
        </>
      )}

      {/* 2-Digit Mechanical Odometer Reels (High-fidelity physical canvas reels) */}
      <AnimatePresence>
        {gamePhase === 'drawing' && currentWinner !== null && (
          tier === 'grand' ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-5 shrink-0 z-20"
            >
              <OdometerCanvas
                winner={currentWinner}
                onComplete={() => finalizeDrawWinner(currentWinner, drawNumber)}
                isDarkMode={isDarkMode}
                soundTicks={soundTicks}
                digits={tier === 'grand' ? 3 : 2}
                duration={tier === 'grand' ? 60.0 : 7.0}
              />
              <div className="mt-3 text-xs font-black uppercase text-amber-500 tracking-widest animate-pulse flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
                <span>ROLLING FOR {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} PLACE SELECTION</span>
              </div>
              
              {tier === 'grand' && gamePhase === 'drawing' && (
                <div className="flex flex-col items-center justify-center gap-2 bg-zinc-950/90 p-4 rounded-2xl border border-zinc-800 w-full mt-0">
                  <h2 className="text-sm font-black text-amber-500 uppercase tracking-widest">Winners List</h2>
                  <div className="flex flex-col gap-1">
                    {winners.first && <div className="text-xs text-emerald-400 font-bold">1st Place: #{winners.first}</div>}
                    {winners.second && <div className="text-xs text-emerald-400 font-bold">2nd Place: #{winners.second}</div>}
                    {winners.third && <div className="text-xs text-emerald-400 font-bold">3rd Place: #{winners.third}</div>}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-6 shrink-0 z-20 text-center"
            >
              <div className="flex flex-col items-center justify-center mb-3">
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-black uppercase tracking-wider animate-pulse">
                  <Zap className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500 animate-bounce" />
                  <span>Mini-VIP</span>
                </div>
              </div>
              <div className="mt-2 text-xs font-bold text-amber-400/80 bg-amber-500/5 border border-amber-500/10 px-4 py-1.5 rounded-full uppercase tracking-wider animate-pulse">
                Rolling for {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} Place
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* Manual Start Button for lobby without mock peers */}
      {!isTheaterActive && gamePhase === 'lobby' && Object.keys(activeGrid).length > 0 && (
        <div className="mb-4">
          <button 
            onClick={triggerGlobalFreeze}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl shadow-md uppercase tracking-wider text-xs transition-colors"
          >
            Force Start Draw Now
          </button>
        </div>
      )}

      {/* 3D Trophy Podium Section (No label, placed under the selectors) */}
      {!isTheaterActive && (
        <>
        <div className="bg-slate-950/50 p-2.5 rounded-2xl border border-zinc-800/60 mb-3 shadow-inner">
          <div className="flex items-end justify-center gap-2 pt-2 pb-1">
            
            {/* 2nd Place (Silver Trophy) */}
            <div className="flex flex-col items-center flex-1 max-w-[90px] text-center">
              <div className="relative">
                {/* Silver Crown */}
                <Crown className="w-4 h-4 text-zinc-400 fill-zinc-400/20 absolute -top-3.5 -right-0.5 rotate-12 drop-shadow-[0_0_3px_rgba(161,161,170,0.5)]" />
                {/* Silver Border Circle */}
                <div className="w-12 h-12 rounded-full border-2 border-zinc-400 bg-zinc-950/80 flex items-center justify-center shadow-[0_3px_8px_rgba(161,161,170,0.15)]">
                  <Trophy className="w-6 h-6 text-zinc-300 drop-shadow-[0_1px_4px_rgba(161,161,170,0.3)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-zinc-500 text-[7px] font-black rounded-md text-white shadow-sm border border-zinc-400/30">
                  #2
                </span>
              </div>
              <div className="mt-2.5 w-full py-1 px-1 bg-zinc-800/80 border border-zinc-700/60 rounded-xl text-center shadow-md">
                <span className="font-mono text-[9px] font-black text-zinc-300">
                  {currentConfig.p2.toLocaleString()}
                </span>
                <span className="text-[7px] text-zinc-400 font-black ml-0.5">ETB</span>
              </div>
            </div>

            {/* 1st Place (Gold Trophy - Elevated) */}
            <div className="flex flex-col items-center flex-1 max-w-[100px] text-center -translate-y-1">
              <div className="relative scale-110">
                {/* Gold Crown */}
                <Crown className="w-5 h-5 text-amber-400 fill-amber-400/30 absolute -top-4.5 left-1/2 -translate-x-1/2 -rotate-12 drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
                {/* Gold Border Circle */}
                <div className="w-14 h-14 rounded-full border-2 border-amber-400 bg-zinc-950/90 flex items-center justify-center shadow-[0_4px_12px_rgba(245,158,11,0.25)]">
                  <Trophy className="w-7 h-7 text-amber-400 drop-shadow-[0_1px_5px_rgba(245,158,11,0.5)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-amber-500 text-[7px] font-black rounded-md text-zinc-950 shadow-md border border-amber-300">
                  #1
                </span>
              </div>
              <div className="mt-3.5 w-full py-1.5 px-1.5 bg-gradient-to-r from-amber-500 to-yellow-400 border border-amber-300 rounded-xl text-center shadow-[0_3px_8px_rgba(245,158,11,0.3)]">
                <span className="font-mono text-[10px] font-black text-zinc-950">
                  {currentConfig.p1.toLocaleString()}
                </span>
                <span className="text-[7px] text-zinc-900 font-black ml-0.5">ETB</span>
              </div>
            </div>

            {/* 3rd Place (Copper/Bronze Trophy) */}
            <div className="flex flex-col items-center flex-1 max-w-[90px] text-center">
              <div className="relative">
                {/* Bronze/Copper Crown */}
                <Crown className="w-4 h-4 text-orange-500 fill-orange-500/10 absolute -top-3.5 -left-0.5 -rotate-12 drop-shadow-[0_0_3px_rgba(249,115,22,0.5)]" />
                {/* Bronze Border Circle */}
                <div className="w-12 h-12 rounded-full border-2 border-orange-500/70 bg-zinc-950/80 flex items-center justify-center shadow-[0_3px_8px_rgba(249,115,22,0.15)]">
                  <Trophy className="w-6 h-6 text-orange-600/95 drop-shadow-[0_1px_4px_rgba(249,115,22,0.3)]" />
                </div>
                {/* Place Badge */}
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-orange-600 text-[7px] font-black rounded-md text-white shadow-sm border border-orange-500/30">
                  #3
                </span>
              </div>
              <div className="mt-2.5 w-full py-1 px-1 bg-orange-950/50 border border-orange-900/60 rounded-xl text-center shadow-md">
                <span className="font-mono text-[9px] font-black text-orange-400">
                  {currentConfig.p3.toLocaleString()}
                </span>
                <span className="text-[7px] text-orange-500 font-black ml-0.5">ETB</span>
              </div>
            </div>

          </div>
        </div>
        </>
      )}

      {/* Grid coordinates list with scroll support */}
      <div className={`flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] ${tier === 'grand' && gamePhase === 'drawing' ? 'opacity-0' : 'opacity-100'}`}>
        
        {/* Progress indicator bar (hidden during active drawing) */}
        {!isTheaterActive && (
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-sm font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider">
              {Object.keys(activeGrid).length}/{currentConfig.slots} Claimed
            </span>
            <div className="text-[10px] font-black uppercase text-blue-500 bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 rounded-full tracking-widest">
              Round #{currentRoundId}
            </div>
          </div>
        )}

        {/* Dynamic coordinate tiles (Compact 8x13 and 7x8 structures) */}
        <div 
          className="grid gap-1"
          style={{
            gridTemplateColumns: 'repeat(8, minmax(0, 1fr))'
          }}
        >
          {Array.from({ length: currentConfig.slots }, (_, i) => {
            const num = i + 1;
            const item = activeGrid[num];
            const isVaporized = vaporizedSlots.includes(num);
            const isWinner = Object.values(winners).includes(num);
            
            // Check if blitz is active on this coordinates slot (Dynamic visual trace)
            const isBlitzActive = blitzActiveTile === num;

            if (isVaporized) {
              return (
                <div 
                  key={num} 
                  className="aspect-square bg-gray-950/60 rounded-lg border border-dashed border-gray-800/30 flex flex-col items-center justify-center text-gray-700/20 text-[10px] font-black select-none"
                >
                  💨
                </div>
              );
            }

            if (item) {
              return (
                <motion.div
                  key={num}
                  onClick={() => handleClaimSlot(num)}
                  whileTap={{ scale: 0.95 }}
                  className={`aspect-square rounded-lg border flex flex-col items-center justify-center p-0.5 cursor-pointer transition-all relative ${
                    isWinner 
                      ? 'bg-gradient-to-b from-green-500 to-green-600 border-green-400 text-white shadow-lg scale-105 z-10'
                      : isBlitzActive
                      ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                      : item.isSelf
                      ? 'bg-gradient-to-b from-blue-600 to-indigo-700 border-blue-400 text-white shadow-xs'
                      : 'bg-gray-800 border-gray-700 text-gray-300'
                  }`}
                  style={isBlitzActive ? { opacity: 1 } : undefined}
                >
                  <span className="text-[10px] font-black font-mono leading-none">{num}</span>
                  <div className="flex items-center gap-0.5 text-[6px] font-semibold tracking-tighter mt-0.5 truncate max-w-full leading-none">
                    <Lock className="w-1.5 h-1.5 shrink-0" />
                    <span className="truncate max-w-[24px]">{item.isSelf ? 'You' : item.username}</span>
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.button
                key={num}
                onClick={() => handleClaimSlot(num)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                className={`aspect-square rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 flex flex-col items-center justify-center p-0.5 shadow-xs hover:border-blue-400 transition-all ${
                  isBlitzActive
                    ? 'bg-amber-500 border-amber-300 text-white scale-110 z-20 shadow-[0_0_15px_#f59e0b] ring-2 ring-amber-400 animate-pulse !opacity-100'
                    : ''
                }`}
                style={isBlitzActive ? { opacity: 1 } : undefined}
              >
                <span className="text-[10px] font-black font-mono text-gray-900 dark:text-gray-100 leading-none">{num}</span>
                <span className="text-[7px] font-black text-blue-600 dark:text-blue-400 tracking-tighter mt-0.5">2K</span>
              </motion.button>
            );
          })}
        </div>

        {/* Jackpot Recent History at the bottom of the scroll view */}
        {currentHistory.length > 0 && (
          <div className="bg-zinc-950/60 border border-zinc-800/80 rounded-2xl p-4 shadow-xl mt-4">
            <h3 className="text-[10px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-1.5 mb-3">
              <RefreshCw className="w-3 h-3" /> Recent Winners
            </h3>
            <div className="space-y-2">
              {currentHistory.map((h, index) => (
                <div key={`${h.roundId}-${index}`} className="flex justify-between items-center text-xs bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-800/40">
                  <span className="font-black text-zinc-400">#{h.roundId}</span>
                  <div className="flex gap-2 font-mono font-bold">
                    {h.winners[1] && <span className="text-yellow-400">1st-{h.winners[1]}</span>}
                    {h.winners[2] && <span className="text-zinc-300">2nd-{h.winners[2]}</span>}
                    {h.winners[3] && <span className="text-amber-600">3rd-{h.winners[3]}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Global Locked Phase 1 Translucent Modal overlay */}
      {gamePhase === 'freeze' && (
        <div className="absolute inset-0 bg-black/20 z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-3xl max-w-xs mx-auto shadow-2xl"
          >
            <div className="w-14 h-14 bg-red-100 dark:bg-red-950/40 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7 text-red-500 animate-pulse" />
            </div>
            <h2 className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider mb-4">Good Luck!</h2>
            <div className="text-4xl font-mono font-black text-red-500 animate-pulse">{freezeCountdown}</div>
          </motion.div>
        </div>
      )}

      {/* Winners Overlay Popup */}
      <AnimatePresence>
        {gamePhase === 'winner' && (
          <div className="absolute inset-0 bg-black/20 z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center">
            {(() => {
              // Extract matching winner number based on active drawIndex
              const winnerNum = drawNumber === 1 ? winners.first : drawNumber === 2 ? winners.second : winners.third;
              if (!winnerNum) return null;

              return (
                <motion.div
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-3xl max-w-xs mx-auto shadow-2xl"
                >
                  <div className="text-4xl mb-2">🎉</div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {drawNumber === 1 ? '1st Place Winner Is:' : drawNumber === 2 ? '2nd Place Winner Is:' : '3rd Place Winner Is:'}
                  </h2>
                  <div className="text-5xl font-black text-gray-900 dark:text-white my-3 animate-bounce tracking-tight font-mono">
                    {winnerNum}
                  </div>
                  <div className="text-[10px] font-black uppercase text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1 rounded-full inline-block border border-indigo-100 dark:border-indigo-900/30">
                    [🔒 {activeGrid[winnerNum]?.username || 'Player'}]
                  </div>
                  <div className="text-xs text-gray-500 mt-3 font-semibold">
                    Prize payout: <span className="font-mono text-green-600 dark:text-green-400 font-bold">
                      {(drawNumber === 1 ? currentConfig.p1 : drawNumber === 2 ? currentConfig.p2 : currentConfig.p3).toLocaleString()} ETB
                    </span>
                  </div>
                </motion.div>
              );
            })()}
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
