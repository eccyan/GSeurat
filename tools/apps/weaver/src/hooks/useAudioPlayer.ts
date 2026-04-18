import { useEffect, useRef } from 'react';
import { useWeaverStore } from '../store/useWeaverStore.js';
import { framesToSeconds } from '../lib/frameUtils.js';

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export function useAudioPlayer() {
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<GainNode[]>([]);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const startFrameRef = useRef<number>(0);

  const isPlaying = useWeaverStore((s) => s.isPlaying);

  useEffect(() => {
    if (isPlaying) {
      startPlayback();
    } else {
      stopPlayback();
    }
    return () => stopPlayback();
  }, [isPlaying]);

  function startPlayback() {
    const state = useWeaverStore.getState();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();

    const stems = state.stems;
    const sampleRate = state.sampleRate;
    const loopStart = state.loopStart;
    const loopEnd = state.loopEnd;
    const loopEnabled = state.loopEnabled;
    const playheadFrame = state.playheadFrame;

    // Clean up any prior sources
    stopSources();

    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];

    const offsetSec = framesToSeconds(playheadFrame, sampleRate);

    for (const stem of stems) {
      if (!stem.audioBuffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = stem.audioBuffer;

      const gain = ctx.createGain();
      gain.gain.value = stem.initialVolume;
      source.connect(gain).connect(ctx.destination);

      if (loopEnabled && loopEnd > loopStart) {
        source.loop = true;
        source.loopStart = framesToSeconds(loopStart, sampleRate);
        source.loopEnd = framesToSeconds(loopEnd, sampleRate);
      }

      source.start(0, offsetSec);
      sources.push(source);
      gains.push(gain);
    }

    sourcesRef.current = sources;
    gainsRef.current = gains;
    startTimeRef.current = ctx.currentTime;
    startFrameRef.current = playheadFrame;

    // Animation frame loop to update playhead
    const tick = () => {
      const s = useWeaverStore.getState();
      if (!s.isPlaying) return;

      const elapsed = ctx.currentTime - startTimeRef.current;
      let frame = startFrameRef.current + Math.round(elapsed * sampleRate);

      // Wrap within loop region if looping
      if (loopEnabled && loopEnd > loopStart && frame >= loopEnd) {
        const loopLen = loopEnd - loopStart;
        frame = loopStart + ((frame - loopStart) % loopLen);
      }

      // Stop at end when not looping
      if (!loopEnabled || loopEnd <= loopStart) {
        const maxLen = s.maxFrames();
        if (frame >= maxLen) {
          s.setIsPlaying(false);
          s.setPlayheadFrame(maxLen);
          return;
        }
      }

      s.setPlayheadFrame(frame);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  function stopSources() {
    for (const src of sourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    sourcesRef.current = [];
    gainsRef.current = [];
  }

  function stopPlayback() {
    stopSources();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }
}
