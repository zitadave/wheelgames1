import React, { useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { playTick, playSpinStart } from '../utils/sound';

interface WheelProps {
  status: "betting" | "balancing" | "spinning" | "result";
  winner?: number;
  soundTicks: boolean;
}

export const Wheel = React.memo(function Wheel({ status, winner, soundTicks }: WheelProps) {
  const rotate = useMotionValue(0);
  const prevStatus = useRef(status);
  const lastTickSegment = useRef(0);
  const soundTicksRef = useRef(soundTicks);

  useEffect(() => {
    soundTicksRef.current = soundTicks;
  }, [soundTicks]);

  useEffect(() => {
    let animationControls: any;

    if (status === 'spinning' && winner && prevStatus.current !== 'spinning') {
      const orderAtTop = [1, 6, 5, 4, 3, 2];
      const targetIndex = orderAtTop.indexOf(winner);
      const targetRotation = 360 * 10 + (targetIndex * 60); // 10 full spins

      if (soundTicksRef.current) playSpinStart();

      const currentRot = rotate.get() % 360;
      rotate.set(currentRot);
      animationControls = animate(rotate, targetRotation, {
        duration: 6,
        ease: [0.3, 0.9, 0.4, 1.0],
        onUpdate: (latest) => {
          const currentSegment = Math.floor((latest + 30) / 60);
          if (currentSegment !== lastTickSegment.current) {
            if (soundTicksRef.current) playTick();
            lastTickSegment.current = currentSegment;
          }
        }
      });
    } else if (status === 'betting' || status === 'balancing') {
      const currentRot = rotate.get() % 360;
      rotate.set(currentRot);
      animationControls = animate(rotate, currentRot + 360, {
        duration: 40,
        ease: "linear",
        repeat: Infinity,
      });
    } else if (status === 'result') {
      // do nothing, let it rest
    }
    prevStatus.current = status;

    return () => {
      if (animationControls) {
        animationControls.stop();
      }
    };
  }, [status, winner, rotate]);

  // Pointer Color
  const pointerColor = useTransform(rotate, (r) => {
    const normalized = ((r % 360) + 360) % 360;
    const segmentIndex = Math.floor(((normalized + 30) % 360) / 60);
    const orderAtTop = [1, 6, 5, 4, 3, 2];
    const num = orderAtTop[segmentIndex % 6];
    return num % 2 === 0 ? '#111111' : '#dc2626'; // black for even, red for odd
  });

  const segments = [1, 2, 3, 4, 5, 6];

  return (
    <div className="relative w-[280px] h-[280px] mx-auto my-6">
      {/* 3D Elevated Pointer */}
      <motion.div 
        className="absolute top-[-42px] left-1/2 -translate-x-1/2 w-12 h-14 z-20 drop-shadow-[0_8px_10px_rgba(0,0,0,0.4)] pointer-events-none"
        style={{ 
          color: pointerColor,
        }}
      >
        <svg viewBox="0 0 48 56" className="w-full h-full filter drop-shadow-[0_2px_3px_rgba(0,0,0,0.2)]">
          {/* Left side face (Bevel highlight) */}
          <path 
            d="M 24 50 L 6 10 L 24 10 Z" 
            fill="currentColor"
          />
          {/* Semi-transparent highlight white */}
          <path 
            d="M 24 50 L 6 10 L 24 10 Z" 
            fill="white"
            fillOpacity="0.25"
          />
          {/* Right side face (Bevel shadow) */}
          <path 
            d="M 24 50 L 24 10 L 42 10 Z" 
            fill="currentColor"
          />
          {/* Semi-transparent shadow black */}
          <path 
            d="M 24 50 L 24 10 L 42 10 Z" 
            fill="black"
            fillOpacity="0.35"
          />
        </svg>
      </motion.div>
      
      {/* Wheel Canvas */}
      <motion.div 
        className="w-full h-full rounded-full border border-gray-200 dark:border-gray-800 shadow-[0_20px_50px_rgba(0,0,0,0.35)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)] overflow-hidden relative"
        style={{ rotate }}
      >
        <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
          <g transform="rotate(-30 50 50)">
            {segments.map((num, i) => {
              const isEven = num % 2 === 0;
              const C = 2 * Math.PI * 25;
              const segmentLength = C / 6;
              return (
                <circle
                  key={num}
                  cx="50"
                  cy="50"
                  r="25"
                  fill="transparent"
                  stroke={isEven ? '#111111' : '#dc2626'}
                  strokeWidth="50"
                  strokeDasharray={`${segmentLength} ${C}`}
                  strokeDashoffset={-segmentLength * i}
                />
              );
            })}
          </g>
          {segments.map((num, i) => {
            const isEven = num % 2 === 0;
            const angle = (i * 60) * (Math.PI / 180);
            const x = 50 + 35 * Math.cos(angle);
            const y = 50 + 35 * Math.sin(angle);
            return (
              <g key={`group-${num}`} transform={`rotate(${i * 60 + 90}, ${x}, ${y})`}>
                <text
                  x={x}
                  y={y - 3}
                  fill="white"
                  fontSize="12"
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {num}
                </text>
                <text
                  x={x}
                  y={y + 5}
                  fill="rgba(255, 255, 255, 0.9)"
                  fontSize="4.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {isEven ? 'ሞላ' : 'ጎደለ'}
                </text>
              </g>
            );
          })}
        </svg>
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-full border-2 border-gray-400 dark:border-gray-600 z-10 shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)] transition-colors duration-300"></div>
      </motion.div>
    </div>
  );
});
