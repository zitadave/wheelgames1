import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Coins, Lock, Check, Trophy, Sparkles, Zap, RefreshCw, Volume2, VolumeX, Medal } from 'lucide-react';

interface WheelOfChanceProps {
  balance: number;
  setBalance: React.Dispatch<React.SetStateAction<number>>;
  setTransactions: React.Dispatch<React.SetStateAction<any[]>>;
  isDarkMode: boolean;
  soundTicks: boolean;
  onBack?: () => void;
  socket?: any;
  userId?: string;
}

type GamePhase = 'lobby' | 'countdown' | 'spinning' | 'announcing' | 'complete';

export function WheelOfChance({
  balance,
  setBalance,
  setTransactions,
  isDarkMode,
  soundTicks: parentSoundTicks,
  onBack,
  socket,
  userId
}: WheelOfChanceProps) {
  // Local sound state
  const [soundEnabled, setSoundEnabled] = useState(parentSoundTicks);

  // Active room selection
  const [activeRoom, setActiveRoom] = useState<'1-10' | '1-20'>('1-10');
  const maxSlots = activeRoom === '1-10' ? 10 : 20;
  const entryFee = activeRoom === '1-10' ? 500 : 1000; // ETB

  // Game flow states
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [countdown, setCountdown] = useState<number>(5);
  const [claimedSlots, setClaimedSlots] = useState<{ [key: number]: { isSelf: boolean; username: string } }>({});
  const [activeSectors, setActiveSectors] = useState<number[]>(() => {
    const saved = sessionStorage.getItem(`wheelOfChanceState_${activeRoom}`);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.activeSectors && state.activeSectors.length > 0) return state.activeSectors;
      } catch (e) {}
    }
    return [];
  });
  const [currentDraw, setCurrentDraw] = useState<1 | 2 | 3>(1);
  const [winners, setWinners] = useState<{ 1?: number; 2?: number; 3?: number }>({});
  const [justDrawnWinner, setJustDrawnWinner] = useState<number | null>(null);
  const [statusFilament, setStatusFilament] = useState<string>('• Room open. Reserve your ticket to start...');

  // Restore state on mount
  useEffect(() => {
    const savedState = sessionStorage.getItem(`wheelOfChanceState_${activeRoom}`);
    if (savedState) {
      try {
        const state = JSON.parse(savedState);
        setPhase(state.phase);
        setCountdown(state.countdown);
        setClaimedSlots(state.claimedSlots);
        setActiveSectors(state.activeSectors);
        setCurrentDraw(state.currentDraw);
        setWinners(state.winners);
        setJustDrawnWinner(state.justDrawnWinner);
        setStatusFilament(state.statusFilament);
        if (state.rotation) {
          rotationRef.current = state.rotation;
        }
      } catch (e) {
        resetRoom();
      }
    } else {
      resetRoom();
    }
  }, [activeRoom]);

  // Persist state
  useEffect(() => {
    sessionStorage.setItem(`wheelOfChanceState_${activeRoom}`, JSON.stringify({
      phase,
      countdown,
      claimedSlots,
      activeSectors,
      currentDraw,
      winners,
      justDrawnWinner,
      statusFilament,
      rotation: rotationRef.current
    }));
  }, [phase, countdown, claimedSlots, activeSectors, currentDraw, winners, justDrawnWinner, statusFilament, activeRoom]);

  // Wheel animation references
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationRef = useRef<number>(0);
  const isSpinningRef = useRef<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const isMounted = useRef<boolean>(true);

  // Sound generator
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playBeep = (freq = 440, duration = 0.05, type: 'sine' | 'triangle' | 'sawtooth' | 'square' = 'sine') => {
    if (!soundEnabled || !isMounted.current) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      // Audio fails gracefully
    }
  };

  // Pastel theme desaturated premium colors
  const premiumColors = useMemo(() => [
    '#93c5fd', // Soft Blue
    '#fda4af', // Soft Rose
    '#a7f3d0', // Soft Mint
    '#fde047', // Soft Yellow
    '#d8b4fe', // Soft Purple
    '#fdba74', // Soft Orange
    '#c4b5fd', // Soft Violet
    '#f9a8d4', // Soft Pink
    '#86efac', // Soft Emerald
    '#67e8f9', // Soft Cyan
    '#cbd5e1', // Slate Gray
    '#fca5a5', // Light Red
  ], []);

  const getSectorColor = (num: number) => {
    return premiumColors[(num - 1) % premiumColors.length];
  };



  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const resetRoom = () => {
    sessionStorage.removeItem(`wheelOfChanceState_${activeRoom}`);
    rotationRef.current = 0;
    isSpinningRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setPhase('lobby');
    setCurrentDraw(1);
    setWinners({});
    setJustDrawnWinner(null);
    setStatusFilament('• Room open. Reserve your ticket to start...');

    setClaimedSlots({});
    setActiveSectors(Array.from({ length: maxSlots }, (_, i) => i + 1));
  };



  const startCountdown = () => {
    if (!isMounted.current) return;
    setPhase('countdown');
    setCountdown(10);
    setActiveSectors(Array.from({ length: maxSlots }, (_, i) => i + 1));
  };

  // Countdown timer loop
  useEffect(() => {
    if (phase !== 'countdown') return;

    if (countdown > 0) {
      const timer = setTimeout(() => {
        if (!isMounted.current) return;
        setCountdown(prev => prev - 1);
        playBeep(580, 0.1, 'sine');
        setStatusFilament(`• All slots claimed! Drawing starting in ${countdown}s...`);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      drawWinnerForCurrentTier();
    }
  }, [phase, countdown]);

  const handleClaimSlot = (num: number) => {
    if (phase !== 'lobby') return;
    
    if (claimedSlots[num]) {
      if (claimedSlots[num].isSelf) {
        // Unclaim
        setBalance(prev => {
          const newBalance = prev + entryFee;
          socket?.emit('logTransaction', { userId, amount: entryFee, type: 'refund', description: `Released Slot #${num} (${activeRoom} Room)`, newBalance });
          return newBalance;
        });
        setTransactions(prev => [
          { id: Date.now(), type: 'bet', desc: `Released Slot #${num} (${activeRoom} Room)`, amount: entryFee, date: 'Just now', positive: true },
          ...prev
        ]);
        setClaimedSlots(prev => {
          const next = { ...prev };
          delete next[num];
          setStatusFilament(`• Slot #${num} released.`);
          return next;
        });
        playBeep(440, 0.1, 'sine');
      } else {
        setStatusFilament('• ❌ Slot already secured by another player!');
        playBeep(220, 0.25, 'sawtooth');
      }
      return;
    }

    if (balance < entryFee) {
      setStatusFilament('• ❌ Insufficient balance for this room!');
      playBeep(220, 0.25, 'sawtooth');
      return;
    }

    setBalance(prev => {
      const newBalance = prev - entryFee;
      socket?.emit('logTransaction', { userId, amount: -entryFee, type: 'bet', description: `Secured Slot #${num} (P2P ${activeRoom} Room)`, newBalance });
      return newBalance;
    });
    setTransactions(prev => [
      { id: Date.now(), type: 'bet', desc: `Secured Slot #${num} (P2P ${activeRoom} Room)`, amount: -entryFee, date: 'Just now', positive: false },
      ...prev
    ]);

    setClaimedSlots(prev => {
      const next = { ...prev, [num]: { isSelf: true, username: 'You' } };
      const count = Object.keys(next).length;
      playBeep(880, 0.12, 'sine');

      if (count === maxSlots) {
        setTimeout(() => {
          if (!isMounted.current) return;
          startCountdown();
        }, 300);
      } else {
        setStatusFilament(`• Slot #${num} claimed. ${count}/${maxSlots} filled...`);
      }
      return next;
    });
  };

  // Recover spinning state if interrupted
  useEffect(() => {
    if (phase === 'spinning' && !isSpinningRef.current) {
      // It was interrupted! Let's resume by calling the draw function again
      drawWinnerForCurrentTier();
    }
  }, [phase]);

  // Sequential Drawing Engine
  const drawWinnerForCurrentTier = (sectorsOverride?: number[], drawTierOverride?: number) => {
    const currentSectors = sectorsOverride || activeSectors;
    const thisDraw = drawTierOverride || currentDraw;
    if (currentSectors.length === 0) return;

    setPhase('spinning');
    setJustDrawnWinner(null);
    const tierName = thisDraw === 1 ? '1st Place' : thisDraw === 2 ? '2nd Place' : '3rd Place';
    setStatusFilament(`• Drawing the ${tierName} Winner...`);

    isSpinningRef.current = true;

    // Pick a random winner from the remaining active sectors
    const randIndex = Math.floor(Math.random() * currentSectors.length);
    const winningSectorVal = currentSectors[randIndex];

    // Align rotation so pointer (top, -90 deg, or 270 deg) lands on winningSectorVal
    const totalSectors = currentSectors.length;
    const sliceAngle = 360 / totalSectors;
    const sectorIndex = currentSectors.indexOf(winningSectorVal);

    // Randomize the landing position inside the sector (excluding the 18% boundaries on both edges to avoid landing on a separation line)
    const randomFraction = 0.18 + Math.random() * 0.64;
    const offsetOfSlice = (sectorIndex + randomFraction) * sliceAngle;
    
    // Use 8 full rotations instead of 80 to allow a smooth, gradual ease-out deceleration
    const targetRotation = 360 * 8 + 270 - offsetOfSlice;

    const startRotation = rotationRef.current;
    const distance = targetRotation - startRotation;
    const duration = 18000; // 18 seconds spin duration for incredible suspense
    const startTime = performance.now();

    let lastTickAngle = 0;

    const animateWheel = (now: number) => {
      if (!isMounted.current) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Super slow suspenseful ease-out curve that starts fast but slows down to a crawl at the end
      const ease = Math.pow(progress, 0.22) * (1 - Math.pow(1 - progress, 180));
      rotationRef.current = startRotation + distance * ease;

      // Click sound tick
      const currentAngleNorm = (rotationRef.current % 360 + 360) % 360;
      const deltaTick = Math.floor(currentAngleNorm / sliceAngle);
      if (deltaTick !== lastTickAngle) {
        playBeep(640 + (deltaTick % totalSectors) * 15, 0.02, 'sine');
        lastTickAngle = deltaTick;
      }

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animateWheel);
      } else {
        isSpinningRef.current = false;
        
        setJustDrawnWinner(winningSectorVal);
        setWinners(prev => ({ ...prev, [thisDraw]: winningSectorVal }));
        
        // Wait 1.5s to allow the final frame to render and look fully stopped before announcement
        setTimeout(() => {
          if (!isMounted.current) return;
          setPhase('announcing');
        }, 1500);

        // Payout Calculations based on room & draw tier
        const grossPool = maxSlots * entryFee;
        let payoutAmount = 0;

        if (activeRoom === '1-10') {
          payoutAmount = thisDraw === 1 ? Math.floor(grossPool * 0.8) : Math.floor(grossPool * 0.1);
        } else {
          payoutAmount = thisDraw === 1 
            ? Math.floor(grossPool * 0.7) 
            : thisDraw === 2 
            ? Math.floor(grossPool * 0.15) 
            : Math.floor(grossPool * 0.05);
        }

        const claim = claimedSlots[winningSectorVal];
        const isSelfWinner = claim?.isSelf;

        if (isSelfWinner) {
          setBalance(b => {
            const newBalance = b + payoutAmount;
            socket?.emit('logGamePlay', { userId, gameType: 'Chance ' + activeRoom, result: `${tierName} Win`, winAmount: payoutAmount, newBalance });
            socket?.emit('logTransaction', { userId, amount: payoutAmount, type: 'win', description: `🏆 P2P ${tierName} Grand Victory (#${winningSectorVal})`, newBalance });
            return newBalance;
          });
          setTransactions(prev => [
            { id: Date.now(), type: 'reward', desc: `🏆 P2P ${tierName} Grand Victory (#${winningSectorVal})`, amount: payoutAmount, date: 'Just now', positive: true },
            ...prev
          ]);
          playBeep(880, 0.4, 'sine');
          setTimeout(() => {
            if (!isMounted.current) return;
            playBeep(1320, 0.4, 'sine');
          }, 120);
        } else {
          playBeep(523, 0.25, 'sine');
        }

        setStatusFilament(`• Spot #${winningSectorVal} (${claim?.username || 'Empty'}) is the ${tierName} Winner!`);

        // Wait 5 seconds for announcement display, then evict the sector and proceed immediately
        setTimeout(() => {
          if (!isMounted.current) return;
          // Evict the winning slot
          const remaining = currentSectors.filter(s => s !== winningSectorVal);
          setActiveSectors(remaining);

          // Re-align starting rotation reference for seamless future spins
          rotationRef.current = 0;

          // Transition logic
          const hasMoreDraws = activeRoom === '1-10' ? thisDraw < 2 : thisDraw < 3;
          if (hasMoreDraws) {
            const nextDraw = (thisDraw + 1) as 1 | 2 | 3;
            setCurrentDraw(nextDraw);
            setTimeout(() => {
              if (!isMounted.current) return;
              drawWinnerForCurrentTier(remaining, nextDraw);
            }, 500);
          } else {
            // New round starts immediately as requested!
            setTimeout(() => {
              if (!isMounted.current) return;
              resetRoom();
            }, 500);
          }
        }, 5000); // 5 seconds announcement pop-up
      }
    };

    animationFrameRef.current = requestAnimationFrame(animateWheel);
  };

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDestroyed = false;

    const draw = () => {
      if (isDestroyed) return;
      const width = canvas.width;
      const height = canvas.height;
      const cx = width / 2;
      const cy = height / 2;
      const radius = width / 2 - 12;

      ctx.clearRect(0, 0, width, height);

      // Draw shadow background
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fill();

      const numSectors = activeSectors.length;
      if (numSectors === 0) return;

      const sliceAngle = (Math.PI * 2) / numSectors;
      const currentRotationRad = (rotationRef.current * Math.PI) / 180;

      // Draw sectors
      activeSectors.forEach((sectorNum, index) => {
        const startAngle = index * sliceAngle + currentRotationRad;
        const endAngle = (index + 1) * sliceAngle + currentRotationRad;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();

        const isJustDrawn = justDrawnWinner === sectorNum && phase === 'announcing';

        if (isJustDrawn) {
          // Flash winner gold / glow color
          const flash = Math.floor(Date.now() / 150) % 2 === 0;
          ctx.fillStyle = flash ? '#fbbf24' : '#d97706';
        } else {
          ctx.fillStyle = getSectorColor(sectorNum);
        }
        ctx.fill();

        // Stroke borders
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = isDarkMode ? 'rgba(15, 23, 42, 0.35)' : 'rgba(255, 255, 255, 0.4)';
        ctx.stroke();

        // Draw label text
        ctx.save();
        ctx.translate(cx, cy);
        const textAngle = startAngle + sliceAngle / 2;
        ctx.rotate(textAngle);

        ctx.fillStyle = isDarkMode ? '#1e293b' : '#334155';
        ctx.font = 'bold 14px font-mono, system-ui';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(sectorNum.toString(), radius - 20, 0);

        // Gold star if self claimed
        const claim = claimedSlots[sectorNum];
        if (claim && claim.isSelf) {
          ctx.beginPath();
          ctx.arc(radius - 8, 0, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#ef4444';
          ctx.fill();
        }

        ctx.restore();
      });

      // Gold center wheel hub
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fillStyle = isDarkMode ? '#0f172a' : '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 6;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#eab308';
      ctx.shadowBlur = 0;
      ctx.stroke();

      // Hub inner count display
      ctx.fillStyle = isDarkMode ? '#ffffff' : '#0f172a';
      ctx.font = 'black 11px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(numSectors.toString(), cx, cy);

      requestAnimationFrame(draw);
    };

    draw();

    return () => {
      isDestroyed = true;
    };
  }, [activeSectors, justDrawnWinner, phase, isDarkMode]);

  const gridCells = Array.from({ length: maxSlots }, (_, i) => i + 1);

  // Return formatted display names of winners for summary
  const getWinnerInfo = (drawIndex: 1 | 2 | 3) => {
    const spot = winners[drawIndex];
    if (!spot) return null;
    const claim = claimedSlots[spot];
    const grossPool = maxSlots * entryFee;
    
    let prize = 0;
    if (activeRoom === '1-10') {
      prize = drawIndex === 1 ? Math.floor(grossPool * 0.8) : Math.floor(grossPool * 0.1);
    } else {
      prize = drawIndex === 1 
        ? Math.floor(grossPool * 0.7) 
        : drawIndex === 2 
        ? Math.floor(grossPool * 0.15) 
        : Math.floor(grossPool * 0.05);
    }

    return {
      spot,
      username: claim?.username || 'Peer',
      isSelf: claim?.isSelf || false,
      prize,
    };
  };

  return (
    <div className="flex-1 flex flex-col justify-start text-white select-none relative pb-6">
      
      {/* 1. Room Switcher Tabs - Rendered at the absolute top */}
      <div className="flex justify-center mt-1 mb-3 shrink-0">
        <div className="inline-flex bg-zinc-900/80 p-1 rounded-full border border-zinc-800">
          <button
            onClick={() => {
              if (phase === 'lobby') setActiveRoom('1-10');
            }}
            disabled={phase !== 'lobby'}
            className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all duration-300 ${
              activeRoom === '1-10'
                ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)] font-black'
                : 'text-gray-400 hover:text-gray-200 font-bold'
            } ${phase !== 'lobby' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            🎯 1–10 Room
          </button>
          <button
            onClick={() => {
              if (phase === 'lobby') setActiveRoom('1-20');
            }}
            disabled={phase !== 'lobby'}
            className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-wider transition-all duration-300 ${
              activeRoom === '1-20'
                ? 'bg-blue-600 text-white shadow-[0_0_12px_rgba(37,99,235,0.4)] font-black'
                : 'text-gray-400 hover:text-gray-200 font-bold'
            } ${phase !== 'lobby' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            🎯 1–20 Room
          </button>
        </div>
      </div>

      {/* 2. Increased Size Center Wheel with Golden Needle */}
      <div className="relative w-[300px] h-[300px] mx-auto my-2 flex items-center justify-center shrink-0">
        
        {/* Soft atmospheric background glow */}
        <div className="absolute inset-0 rounded-full bg-blue-500/5 blur-3xl pointer-events-none animate-pulse" />

        {/* Golden Pin Pointer Needle */}
        <div className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-5.5 h-8 z-30 pointer-events-none drop-shadow-[0_3px_5px_rgba(0,0,0,0.6)]">
          <svg viewBox="0 0 24 40" className="w-full h-full">
            <path
              d="M12 40 L2 12 A 10 10 0 0 1 22 12 Z"
              fill="#f59e0b"
              stroke="#d97706"
              strokeWidth="1.5"
            />
            <path
              d="M12 40 L12 2 A 10 10 0 0 1 22 12 Z"
              fill="rgba(255, 255, 255, 0.2)"
            />
          </svg>
        </div>

        {/* HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          width={300}
          height={300}
          className="w-full h-full rounded-full border border-zinc-800 shadow-[0_12px_32px_rgba(0,0,0,0.7)]"
        />
      </div>

      {/* 3. Status Filament Info Line */}
      <div className="text-center py-1.5 shrink-0 h-7 flex items-center justify-center">
        <span className="text-[11px] font-bold text-blue-400 dark:text-blue-300 tracking-wide animate-pulse">
          {statusFilament}
        </span>
      </div>

      {/* Manual Start Button */}
      {phase === 'lobby' && Object.keys(claimedSlots).length > 0 && (
        <div className="px-4 mb-2">
          <button 
            onClick={startCountdown}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-xl shadow-md uppercase tracking-wider text-xs transition-colors"
          >
            Force Start Wheel Now
          </button>
        </div>
      )}

      {/* 4. Good Luck Countdown Overlay */}
      <AnimatePresence>
        {phase === 'countdown' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center text-center p-6"
          >
            <motion.div
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="space-y-4"
            >
              <div className="text-6xl animate-bounce">✨</div>
              <h2 className="text-3xl font-black tracking-wider text-yellow-400 font-sans uppercase">Good Luck!</h2>
              <p className="text-zinc-400 text-xs max-w-xs mx-auto leading-relaxed font-sans">
                The automated Cascading Eviction draw is about to commence!
              </p>
              
              <div className="relative flex items-center justify-center my-6">
                <div className="absolute w-24 h-24 rounded-full border-4 border-yellow-500/20 animate-ping" />
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-yellow-500 to-amber-600 flex items-center justify-center shadow-lg border-2 border-yellow-300">
                  <span className="font-mono text-3xl font-black text-white">{countdown}</span>
                </div>
              </div>

              <span className="text-[10px] font-bold text-blue-400 tracking-widest uppercase block animate-pulse">
                Spinning starting in {countdown} seconds...
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. Winner Draw Interstitial Announcement Overlay (5s show time) */}
      <AnimatePresence>
        {phase === 'announcing' && justDrawnWinner !== null && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-x-6 top-[20%] z-50 bg-zinc-950/95 border border-zinc-800/80 p-6 rounded-3xl text-center shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-md"
          >
            <div className="text-4xl mb-2">
              {currentDraw === 1 ? '🏆' : currentDraw === 2 ? '🥈' : '🥉'}
            </div>
            <span className="text-[10px] font-black tracking-widest text-zinc-400 uppercase">
              {currentDraw === 1 ? '1st Place Grand Winner' : currentDraw === 2 ? '2nd Place Winner' : '3rd Place Winner'}
            </span>
            
            <div className="text-4xl font-mono font-black text-yellow-400 my-2 animate-pulse">
              Spot #{justDrawnWinner}
            </div>

            <div className="bg-white/5 border border-white/5 rounded-xl py-2 px-4 inline-block mb-3">
              <span className="text-[9px] font-bold text-zinc-300 uppercase block">REWARD PAYOUT</span>
              <span className="text-sm font-black font-mono text-green-400">
                +{ (activeRoom === '1-10' 
                    ? (currentDraw === 1 ? maxSlots * entryFee * 0.8 : maxSlots * entryFee * 0.1)
                    : (currentDraw === 1 ? maxSlots * entryFee * 0.7 : currentDraw === 2 ? maxSlots * entryFee * 0.15 : maxSlots * entryFee * 0.05)
                   ).toLocaleString() } ETB
              </span>
            </div>

            <div className="text-xs text-zinc-300 font-semibold">
              {claimedSlots[justDrawnWinner]?.username === 'You' ? (
                <span className="text-green-400 font-bold block animate-bounce">
                  ✨ CONGRATULATIONS! YOU WON! ✨
                </span>
              ) : (
                <span className="text-zinc-400">Winner Handle: <strong className="text-zinc-200">@{claimedSlots[justDrawnWinner]?.username || 'Player'}</strong></span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 6. Main Ticket Grid & Summary Panels */}
      <div className="flex-1 overflow-y-auto px-1 pr-1 pb-4 max-h-[320px]">
        {phase === 'lobby' && (
          <div className="space-y-4 mb-4">
            <div>
              <div className="flex justify-between items-center mb-2 px-1">
                <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">CHOOSE SPOT (Entry: {entryFee} ETB)</span>
                <span className="text-[10px] font-black text-yellow-500 tracking-widest bg-yellow-500/10 border border-yellow-500/20 px-2 rounded-full uppercase">
                  Pool: {Math.round(maxSlots * entryFee * 0.9).toLocaleString()} ETB
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {gridCells.map((num) => {
                  const claim = claimedSlots[num];
                  
                  if (claim) {
                    if (claim.isSelf) {
                      return (
                        <motion.div
                          key={num}
                          initial={{ scale: 0.95, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="aspect-square rounded-xl bg-blue-600 border border-blue-400 flex flex-col items-center justify-center text-white relative shadow-md"
                        >
                          <Check className="w-3.5 h-3.5 text-white font-black" />
                          <span className="text-xs font-mono font-black mt-0.5">#{num}</span>
                        </motion.div>
                      );
                    } else {
                      return (
                        <motion.div
                          key={num}
                          initial={{ scale: 0.95, opacity: 0 }}
                          animate={{ scale: 1, opacity: 0.5 }}
                          className="aspect-square rounded-xl bg-zinc-900 border border-zinc-800/60 flex flex-col items-center justify-center text-zinc-500 pointer-events-none relative"
                        >
                          <Lock className="w-3 h-3 text-zinc-600" />
                          <span className="text-[8px] font-semibold mt-0.5 truncate max-w-[38px] leading-none">{claim.username}</span>
                        </motion.div>
                      );
                    }
                  }

                  // Available cell
                  return (
                    <motion.button
                      key={num}
                      onClick={() => handleClaimSlot(num)}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.95 }}
                      className="aspect-square rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-blue-500 flex flex-col items-center justify-center text-white transition-all cursor-pointer"
                    >
                      <span className="text-sm font-mono font-black">{num}</span>
                      <span className="text-[8px] font-black text-blue-400 mt-0.5 uppercase tracking-tighter">CLAIM</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Premium Payout Trophy Matrix Card - Always Visible */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-3.5 max-w-xs mx-auto text-left mb-4">
          <div className="flex justify-between items-center border-b border-zinc-800/50 pb-2 mb-2">
            <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">Ticket Bet Amount:</span>
            <span className="text-xs font-black font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md">
              {entryFee.toLocaleString()} ETB
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🏆</span>
                <span className="font-bold text-zinc-300 font-sans">1st Place (Gold):</span>
              </div>
              <span className="font-mono font-black text-yellow-400">
                {Math.floor(maxSlots * entryFee * (activeRoom === '1-10' ? 0.8 : 0.7)).toLocaleString()} ETB
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🥈</span>
                <span className="font-bold text-zinc-300 font-sans">2nd Place (Silver):</span>
              </div>
              <span className="font-mono font-black text-zinc-300">
                {Math.floor(maxSlots * entryFee * (activeRoom === '1-10' ? 0.1 : 0.15)).toLocaleString()} ETB
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🥉</span>
                <span className="font-bold text-zinc-300 font-sans">3rd Place (Copper):</span>
              </div>
              {activeRoom === '1-20' ? (
                <span className="font-mono font-black text-amber-600">
                  {Math.floor(maxSlots * entryFee * 0.05).toLocaleString()} ETB
                </span>
              ) : (
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider font-sans">Not Applicable</span>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
