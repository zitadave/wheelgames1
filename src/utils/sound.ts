const AudioContextClass = typeof window !== 'undefined' ? ((window as any).AudioContext || (window as any).webkitAudioContext) : null;
export const audioCtx = AudioContextClass ? new AudioContextClass() : null;

// Unify unlocking of Web Audio API
if (typeof document !== 'undefined' && audioCtx) {
  const unlockAudioContext = () => {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  document.addEventListener('click', unlockAudioContext, { passive: true });
  document.addEventListener('touchstart', unlockAudioContext, { passive: true });
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state !== 'suspended') {
    audioCtx.suspend().catch(() => {});
  }
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

export function playTick() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.01);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.01);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.01);
  } catch (e) {
    console.warn("playTick failed", e);
  }
}

export function playSpinStart() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(250, audioCtx.currentTime + 0.5);
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 2.0);
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, audioCtx.currentTime + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 2.0);
  } catch (e) {
    console.warn("playSpinStart failed", e);
  }
}

export function playWin() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
    osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);
    osc.frequency.setValueAtTime(1046.50, audioCtx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.3);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.0);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 1.0);
  } catch (e) {
    console.warn("playWin failed", e);
  }
}

export function playLoss() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) {
    console.warn("playLoss failed", e);
  }
}

const decodedCache = new Map<string, AudioBuffer>();
let activeSourceNode: AudioBufferSourceNode | null = null;

export function stopCurrentAudio() {
  if (activeSourceNode) {
    try {
      activeSourceNode.stop();
    } catch (e) {
      // Ignored: source already stopped or not started
    }
    activeSourceNode = null;
  }
}

export async function playAudioUrl(url: string, onEnded?: () => void): Promise<void> {
  if (!audioCtx) {
    if (onEnded) onEnded();
    return;
  }

  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch (e) {
      console.warn("Failed to resume AudioContext", e);
    }
  }

  // Ensure any active speech/audio is stopped before starting next
  stopCurrentAudio();

  try {
    let buffer = decodedCache.get(url);
    if (!buffer) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = await audioCtx.decodeAudioData(arrayBuffer);
      decodedCache.set(url, buffer);
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    activeSourceNode = source;
    
    source.onended = () => {
      if (activeSourceNode === source) {
        activeSourceNode = null;
      }
      if (onEnded) {
        onEnded();
      }
    };

    source.start(0);
  } catch (e) {
    console.warn("playAudioUrl failed for", url, e);
    if (onEnded) {
      onEnded();
    }
  }
}
