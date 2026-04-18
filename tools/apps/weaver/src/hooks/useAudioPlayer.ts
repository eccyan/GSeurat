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
  const stems = useWeaverStore((s) => s.stems);
  const loopEnabled = useWeaverStore((s) => s.loopEnabled);

  useEffect(() => {
    if (isPlaying) {
      startPlayback();
    } else {
      stopPlayback();
    }
    return () => stopPlayback();
  }, [isPlaying]);

  // Update source.loop live when loopEnabled changes during playback
  useEffect(() => {
    const sources = sourcesRef.current;
    if (sources.length === 0) return;

    // Resync time references to current playhead so frame calculation
    // doesn't jump when switching between looped/linear tracking
    const ctx = getAudioContext();
    const state = useWeaverStore.getState();
    startTimeRef.current = ctx.currentTime;
    startFrameRef.current = state.playheadFrame;

    const sampleRate = state.sampleRate;
    const loopStart = state.loopStart;
    const loopEnd = state.loopEnd;
    const shouldLoop = loopEnabled && loopEnd > loopStart;
    for (const source of sources) {
      source.loop = shouldLoop;
      if (shouldLoop) {
        source.loopStart = framesToSeconds(loopStart, sampleRate);
        source.loopEnd = framesToSeconds(loopEnd, sampleRate);
      }
    }
  }, [loopEnabled]);

  useEffect(() => {
    const gains = gainsRef.current;
    if (gains.length === 0) return;
    const anySoloed = stems.some(s => s.soloed);
    let gi = 0;
    for (const stem of stems) {
      if (!stem.audioBuffer) continue;
      if (gi >= gains.length) break;
      let vol = stem.initialVolume;
      if (stem.muted) vol = 0;
      if (anySoloed && !stem.soloed) vol = 0;
      gains[gi].gain.value = vol;
      gi++;
    }
  }, [stems]);

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

    const anySoloed = stems.some(s => s.soloed);

    for (const stem of stems) {
      if (!stem.audioBuffer) continue;

      const source = ctx.createBufferSource();
      source.buffer = stem.audioBuffer;

      const gain = ctx.createGain();
      let effectiveVol = stem.initialVolume;
      if (stem.muted) effectiveVol = 0;
      if (anySoloed && !stem.soloed) effectiveVol = 0;
      gain.gain.value = effectiveVol;
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

      // Read current loop state (may have changed since playback started)
      const currentLoopEnabled = s.loopEnabled;

      // Wrap within loop region if looping
      if (currentLoopEnabled && loopEnd > loopStart && frame >= loopEnd) {
        const loopLen = loopEnd - loopStart;
        frame = loopStart + ((frame - loopStart) % loopLen);
      }

      // Stop at end when not looping
      if (!currentLoopEnabled || loopEnd <= loopStart) {
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
