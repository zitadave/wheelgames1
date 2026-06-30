import React, { useState, useEffect, useRef } from 'react';
import { Trophy, Coins, Lock, Sparkles, RefreshCw, AlertTriangle, Zap, Flame, Crown, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { OdometerCanvas } from './OdometerCanvas';

interface JackpotArenaProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  setMockTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  isDarkMode: boolean;
  soundTicks: boolean;
  onTheaterModeChange?: (active: boolean) => void;
}

type JackpotTier = 'mini' | 'grand';

interface Participant {
  username: string;
  isSelf: boolean;
}

export function JackpotArena({
  balance,
  setBalance,
  showNotification,
  setMockTransactions,
  isDarkMode,
  soundTicks,
  onTheaterModeChange,
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

  // Animation States
  const [freezeCountdown, setFreezeCountdown] = useState<number>(10);
  
  // Neon Blitz dynamic active index
  const [blitzActiveTile, setBlitzActiveTile] = useState<number | null>(null);
  const isMounted = useRef<boolean>(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

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
  useEffect(() => {
    if (onTheaterModeChange) {
      onTheaterModeChange(
        gamePhase === 'drawing' ||
        gamePhase === 'winner' ||
        gamePhase === 'vaporizing' ||
        gamePhase === 'complete'
      );
    }
  }, [gamePhase, onTheaterModeChange]);

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

  // Populate grids initially with 65% filled
  useEffect(() => {
    resetLobby();
  }, [tier]);

  const resetLobby = () => {
    const initialFilledCount = Math.floor(currentConfig.slots * 0.65);
    const grid: Record<number, Participant> = {};
    const names = [
      'Dawit', 'Selam', 'Almaz', 'Elias', 'Hana', 'Mulu', 'Yonas', 'Bekele', 'Aster', 'Zenebe',
      'Tadesse', 'Lensa', 'Abdi', 'Tirunesh', 'Haile', 'Kenenisa', 'Derartu', 'Feyisa', 'Sileshi'
    ];
    
    // Shuffle indices
    const indices = Array.from({ length: currentConfig.slots }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

    for (let i = 0; i < initialFilledCount; i++) {
      const spot = indices[i];
      const randomName = names[Math.floor(Math.random() * names.length)];
      grid[spot] = {
        username: randomName,
        isSelf: false
      };
    }

    setTargetGrid(grid);
    setGamePhase('lobby');
    setDrawNumber(1);
    setWinners({});
    setVaporizedSlots([]);
    setBlitzActiveTile(null);
    setReelHundred('0');
    setReelTen('0');
    setReelOne('0');
  };

  // Simulated peer buy-in stream
  useEffect(() => {
    if (gamePhase !== 'lobby') return;

    const currentCount = Object.keys(activeGrid).length;
    if (currentCount >= currentConfig.slots) {
      triggerGlobalFreeze();
      return;
    }

    const interval = setInterval(() => {
      const openSpots: number[] = [];
      for (let i = 1; i <= currentConfig.slots; i++) {
        if (!activeGrid[i]) openSpots.push(i);
      }

      if (openSpots.length === 0) {
        clearInterval(interval);
        triggerGlobalFreeze();
        return;
      }

      const randomSpot = openSpots[Math.floor(Math.random() * openSpots.length)];
      const names = [
        'Dawit', 'Selam', 'Almaz', 'Elias', 'Hana', 'Mulu', 'Yonas', 'Bekele', 'Aster', 'Zenebe',
        'Tadesse', 'Lensa', 'Abdi', 'Tirunesh', 'Haile', 'Kenenisa', 'Derartu', 'Feyisa', 'Sileshi',
        'Tegene', 'Kebebush', 'Mesfin', 'Tigist', 'Sintayehu', 'Helen', 'Ruth', 'Kalkidan', 'Abraham'
      ];
      const randomName = names[Math.floor(Math.random() * names.length)];

      setTargetGrid(prev => ({
        ...prev,
        [randomSpot]: {
          username: randomName,
          isSelf: false
        }
      }));

      // If that filled the last spot, stop interval immediately
      if (Object.keys(activeGrid).length + 1 >= currentConfig.slots) {
        clearInterval(interval);
        triggerGlobalFreeze();
      }
    }, Math.floor(Math.random() * 2000) + 1000);

    return () => clearInterval(interval);
  }, [activeGrid, gamePhase, currentConfig.slots]);

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

    const timer = setTimeout(() => {
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

    // Both tiers run lightning blitz trace for visual excitement
    runNeonLightningBlitz(matchedWinner, drawIndex);
  };

  // Neon Lightning Blitz loop
  const runNeonLightningBlitz = (finalWinner: number, drawIndex: 1 | 2 | 3) => {
    let currentDelay = 35; // starts extremely fast
    const totalDuration = tier === 'grand' ? 30000 : 7000; // 30s for grand, 7s for mini
    const startTime = Date.now();

    // Create a list of available candidate coordinates for visual jumps
    const candidates = Array.from({ length: currentConfig.slots }, (_, i) => i + 1)
      .filter(num => activeGrid[num] && !vaporizedSlots.includes(num));

    const step = () => {
      if (!isMounted.current) return;
      const elapsed = Date.now() - startTime;
      
      if (elapsed > totalDuration - 1200) {
        // Nearing the end, decelerate aggressively and lock into finalWinner
        currentDelay = Math.min(currentDelay * 1.35, 600);
      } else {
        // Smoothly scale up delay to create decelerating trace
        currentDelay = Math.min(currentDelay + 3, 200);
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
          setTimeout(() => {
            finalizeDrawWinner(finalWinner, drawIndex);
          }, 1000);
        }
      } else {
        setTimeout(step, currentDelay);
      }
    };

    setTimeout(step, currentDelay);
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
    const shuffleInterval = setInterval(() => {
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
        setTimeout(() => {
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

      setBalance(prev => prev + prize);
      setMockTransactions(prev => [
        { id: Date.now(), type: 'win', desc: `🏆 Jackpot ${drawIndex}st Place Win!`, amount: prize, date: 'Just now', positive: true },
        ...prev
      ]);
      showNotification(`🎉 Congratulations! You won the Jackpot ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place Prize of ${prize.toLocaleString()} ETB!`, 'success');
    } else {
      showNotification(`Coordinate #${winnerNum} ([🔒 ${activeGrid[winnerNum]?.username || 'Player'}]) claims ${drawIndex === 1 ? '1st' : drawIndex === 2 ? '2nd' : '3rd'} Place!`, 'info');
    }

    // Wait 5 seconds, then vaporize this slot to proceed to the next slot draw
    setTimeout(() => {
      setBlitzActiveTile(null);
      
      if (drawIndex < 3) {
        setGamePhase('vaporizing');
        setVaporizedSlots(prev => [...prev, winnerNum]);
        
        // Wait 2.5 seconds in vaporization phase, then proceed
        setTimeout(() => {
          executeSequentialDraw((drawIndex + 1) as 2 | 3);
        }, 2200);
      } else {
        // Fully complete
        setGamePhase('complete');
        
        // Wait 6 seconds and restart the lobby
        setTimeout(() => {
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
      showNotification('This position is already allocated!', 'error');
      return;
    }

    if (balance < currentConfig.entry) {
      showNotification('Insufficient balance to claim this 2,000 ETB slot!', 'error');
      return;
    }

    setBalance(prev => prev - currentConfig.entry);
    setMockTransactions(prev => [
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
      
      {/* Live Vault Header Area */}
      {!isTheaterActive && (
        <div className="bg-gradient-to-r from-gray-900 via-slate-900 to-indigo-950 p-4 rounded-2xl border border-indigo-500/20 shadow-lg text-white mb-4 flex flex-col gap-2 relative overflow-hidden shrink-0">
          <div className="absolute right-0 top-0 translate-x-1/3 -translate-y-1/3 bg-indigo-500/10 w-24 h-24 rounded-full blur-xl" />
          
          <div className="flex justify-between items-center z-10">
            <div>
              <span className="text-[10px] font-black uppercase text-indigo-400 tracking-widest block">Gross Jackpot Vault</span>
              <div className="flex items-center gap-1.5 mt-0.5 animate-pulse">
                <Trophy className="w-5 h-5 text-yellow-400" />
                <span className="text-xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-200 to-amber-400">
                  {currentConfig.gross.toLocaleString()} ETB
                </span>
              </div>
            </div>
          </div>

          {/* Prize Split Tickers */}
          <div className="grid grid-cols-3 gap-2 border-t border-indigo-900/50 pt-2 text-center text-[10px] font-semibold text-gray-400 mt-1">
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-indigo-300">1st (80%)</span>
              <span className="font-mono text-white font-bold">{currentConfig.p1.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-indigo-300">2nd (14%)</span>
              <span className="font-mono text-white font-bold">{currentConfig.p2.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-[8px] uppercase tracking-wider text-indigo-300">3rd (6%)</span>
              <span className="font-mono text-white font-bold">{currentConfig.p3.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Room Category Tabs */}
      {!isTheaterActive && (
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
                duration={tier === 'grand' ? 30.0 : 7.0}
              />
              <div className="mt-3 text-xs font-black uppercase text-amber-500 tracking-widest animate-pulse flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
                <span>ROLLING FOR {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} PLACE SELECTION</span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-6 shrink-0 z-20 text-center"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-500 animate-pulse mb-3">
                <Zap className="w-6 h-6 text-amber-500 animate-bounce" />
              </div>
              <span className="text-sm font-black uppercase text-amber-500 tracking-widest animate-pulse">
                LIGHTNING BLITZ CURRENTLY ACTIVE
              </span>
              <span className="text-[10px] text-zinc-400 font-bold block mt-1">
                Jumping coordinates at lightspeed...
              </span>
              <div className="mt-4 text-xs font-bold text-amber-400/80 bg-amber-500/5 border border-amber-500/10 px-4 py-1.5 rounded-full uppercase tracking-wider animate-pulse">
                Rolling for {drawNumber === 1 ? '1ST' : drawNumber === 2 ? '2ND' : '3RD'} Place
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* Main Status Bar (Hidden during Odometer phase to maximize tension) */}
      {!isTheaterActive && gamePhase === 'freeze' && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2.5 rounded-xl mb-4 text-center shrink-0 shadow-xs flex items-center justify-center gap-2">
          <div className="text-red-500 text-xs font-black flex items-center gap-1.5 uppercase tracking-wider animate-bounce">
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
            <span>ALL SLOTS ACQUIRED! Drawing starts in {freezeCountdown}s</span>
          </div>
        </div>
      )}

      {/* Grid coordinates list with scroll support */}
      <div className="flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px]">
        
        {/* Progress indicator bar (hidden during active drawing) */}
        {!isTheaterActive && (
          <div className="flex justify-between items-center mb-2 px-1">
            <span className="text-sm font-black uppercase text-blue-600 dark:text-blue-400 tracking-wider">
              {Object.keys(activeGrid).length}/{currentConfig.slots} Claimed
            </span>
          </div>
        )}

        {/* Dynamic coordinate tiles (Compact 8x13 and 7x8 structures) */}
        <div 
          className={`grid gap-1 transition-opacity duration-500 ${isTheaterActive ? 'opacity-15' : 'opacity-100'}`}
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
      </div>

      {/* Global Locked Phase 1 Translucent Modal overlay */}
      {gamePhase === 'freeze' && (
        <div className="absolute inset-0 bg-black/65 backdrop-blur-xs z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 rounded-3xl max-w-xs mx-auto shadow-2xl"
          >
            <div className="w-14 h-14 bg-red-100 dark:bg-red-950/40 rounded-full flex items-center justify-center mx-auto mb-3">
              <Lock className="w-7 h-7 text-red-500 animate-pulse" />
            </div>
            <h2 className="text-base font-black text-gray-900 dark:text-white uppercase tracking-wider">Good Luck!</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">All Matrix Spots Are Locked</p>
            <div className="text-4xl font-mono font-black text-red-500 animate-pulse">{freezeCountdown}</div>
            <span className="text-[10px] font-semibold text-gray-400 block mt-2">
              Neon Lightning Blitz and Odometer drawing starting...
            </span>
          </motion.div>
        </div>
      )}

      {/* Winners Overlay Popup */}
      <AnimatePresence>
        {gamePhase === 'winner' && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-50 rounded-2xl flex flex-col items-center justify-center p-6 text-center">
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
