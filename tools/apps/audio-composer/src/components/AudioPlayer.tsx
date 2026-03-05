import React, {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useComposerStore, LayerId } from '../store/useComposerStore.js';
import { audioBufferToWav as _audioBufferToWav } from '../audio/wav-utils.js';

// ---------------------------------------------------------------------------
// Public API exposed via ref
// ---------------------------------------------------------------------------
export interface AudioPlayerHandle {
  play: () => void;
  stop: () => void;
  seek: (sec: number) => void;
  loadLayerBuffer: (layerId: LayerId, buffer: ArrayBuffer) => Promise<void>;
  crossfadeTo: (volumes: Record<LayerId, number>, rateSec: number) => void;
  exportMix: () => Promise<ArrayBuffer | null>;
}

const LAYER_IDS: LayerId[] = ['bass', 'harmony', 'melody', 'percussion'];

// ---------------------------------------------------------------------------
// AudioPlayer
// ---------------------------------------------------------------------------
export const AudioPlayer = forwardRef<AudioPlayerHandle, Record<string, never>>(
  function AudioPlayer(_props, ref) {
    const ctxRef = useRef<AudioContext | null>(null);
    const masterGainRef = useRef<GainNode | null>(null);
    const layerGainsRef = useRef<Partial<Record<LayerId, GainNode>>>({});
    const layerSourcesRef = useRef<Partial<Record<LayerId, AudioBufferSourceNode>>>({});
    const startTimeRef = useRef<number>(0);
    const startOffsetRef = useRef<number>(0);

    const store = useComposerStore.getState;

    // -------------------------------------------------------------------------
    // Initialize AudioContext on first interaction
    // -------------------------------------------------------------------------
    const ensureCtx = useCallback((): AudioContext => {
      if (!ctxRef.current || ctxRef.current.state === 'closed') {
        const ctx = new AudioContext();
        ctxRef.current = ctx;

        const master = ctx.createGain();
        master.gain.value = store().masterVolume;
        master.connect(ctx.destination);
        masterGainRef.current = master;

        for (const id of LAYER_IDS) {
          const g = ctx.createGain();
          g.gain.value = 0;
          g.connect(master);
          layerGainsRef.current[id] = g;
        }
      }
      return ctxRef.current;
    }, [store]);

    // -------------------------------------------------------------------------
    // Keep master gain synced to store
    // -------------------------------------------------------------------------
    useEffect(() => {
      const unsub = useComposerStore.subscribe((s) => {
        if (masterGainRef.current) {
          masterGainRef.current.gain.value = s.masterVolume;
        }
        // Update per-layer gains
        for (const layer of s.layers) {
          const g = layerGainsRef.current[layer.id];
          if (g) {
            const anySoloed = s.layers.some((l) => l.soloed);
            const effective = layer.muted
              ? 0
              : anySoloed
              ? layer.soloed ? layer.volume : 0
              : layer.volume;
            g.gain.value = effective;
          }
        }
      });
      return unsub;
    }, []);

    // -------------------------------------------------------------------------
    // Playback helpers
    // -------------------------------------------------------------------------
    const stopAllSources = useCallback(() => {
      for (const id of LAYER_IDS) {
        const src = layerSourcesRef.current[id];
        if (src) {
          try { src.stop(); } catch { /* already stopped */ }
          delete layerSourcesRef.current[id];
        }
      }
    }, []);

    const startPlayback = useCallback((offsetSec: number) => {
      const ctx = ensureCtx();
      if (ctx.state === 'suspended') ctx.resume();

      stopAllSources();

      const { layers, loopEnabled, loopRegion } = useComposerStore.getState();

      for (const layer of layers) {
        if (!layer.audioBuffer) continue;
        const g = layerGainsRef.current[layer.id];
        if (!g) continue;

        const src = ctx.createBufferSource();
        src.buffer = layer.audioBuffer;
        src.loop = loopEnabled;
        src.loopStart = loopRegion.startSec;
        src.loopEnd = Math.min(loopRegion.endSec, layer.audioBuffer.duration);
        src.connect(g);

        const clampedOffset = Math.max(0, Math.min(offsetSec, layer.audioBuffer.duration - 0.01));
        src.start(0, clampedOffset);
        layerSourcesRef.current[layer.id] = src;
      }

      startTimeRef.current = ctx.currentTime;
      startOffsetRef.current = offsetSec;
    }, [ensureCtx, stopAllSources]);

    // -------------------------------------------------------------------------
    // Playhead updater
    // -------------------------------------------------------------------------
    const rafRef = useRef<number>(0);

    const tickPlayhead = useCallback(() => {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const { isPlaying, setPlayheadSec, loopEnabled, loopRegion } = useComposerStore.getState();
      if (!isPlaying) return;

      const elapsed = ctx.currentTime - startTimeRef.current;
      let pos = startOffsetRef.current + elapsed;

      if (loopEnabled) {
        const span = loopRegion.endSec - loopRegion.startSec;
        if (span > 0) {
          pos = loopRegion.startSec + ((pos - loopRegion.startSec) % span);
        }
      }

      setPlayheadSec(pos);
      rafRef.current = requestAnimationFrame(tickPlayhead);
    }, []);

    useEffect(() => {
      const unsub = useComposerStore.subscribe((s, prev) => {
        if (s.isPlaying && !prev.isPlaying) {
          const offset = s.playheadSec;
          startPlayback(offset);
          rafRef.current = requestAnimationFrame(tickPlayhead);
        } else if (!s.isPlaying && prev.isPlaying) {
          stopAllSources();
          cancelAnimationFrame(rafRef.current);
        }
      });
      return () => {
        unsub();
        cancelAnimationFrame(rafRef.current);
      };
    }, [startPlayback, stopAllSources, tickPlayhead]);

    // -------------------------------------------------------------------------
    // Imperative handle
    // -------------------------------------------------------------------------
    useImperativeHandle(ref, () => ({
      play() {
        useComposerStore.getState().setPlaying(true);
      },
      stop() {
        useComposerStore.getState().setPlaying(false);
        useComposerStore.getState().setPlayheadSec(0);
      },
      seek(sec: number) {
        const wasPlaying = useComposerStore.getState().isPlaying;
        if (wasPlaying) {
          stopAllSources();
          startPlayback(sec);
          startOffsetRef.current = sec;
          if (ctxRef.current) startTimeRef.current = ctxRef.current.currentTime;
        }
        useComposerStore.getState().setPlayheadSec(sec);
      },
      async loadLayerBuffer(layerId: LayerId, buffer: ArrayBuffer) {
        const ctx = ensureCtx();
        const decoded = await ctx.decodeAudioData(buffer.slice(0));
        useComposerStore.getState().setLayerBuffer(layerId, decoded);
      },
      crossfadeTo(volumes: Record<LayerId, number>, rateSec: number) {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const now = ctx.currentTime;
        for (const id of LAYER_IDS) {
          const g = layerGainsRef.current[id];
          if (g && volumes[id] !== undefined) {
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(g.gain.value, now);
            g.gain.linearRampToValueAtTime(volumes[id], now + rateSec);
          }
        }
      },
      async exportMix(): Promise<ArrayBuffer | null> {
        const { layers, loopRegion } = useComposerStore.getState();
        const duration = loopRegion.endSec - loopRegion.startSec;
        if (duration <= 0) return null;

        const sampleRate = 44100;
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
        const masterGain = offlineCtx.createGain();
        masterGain.gain.value = useComposerStore.getState().masterVolume;
        masterGain.connect(offlineCtx.destination);

        for (const layer of layers) {
          if (!layer.audioBuffer || layer.muted) continue;
          const g = offlineCtx.createGain();
          g.gain.value = layer.volume;
          g.connect(masterGain);
          const src = offlineCtx.createBufferSource();
          src.buffer = layer.audioBuffer;
          const offset = Math.max(0, loopRegion.startSec);
          src.start(0, offset);
          src.connect(g);
        }

        const rendered = await offlineCtx.startRendering();
        return _audioBufferToWav(rendered);
      },
    }), [ensureCtx, startPlayback, stopAllSources]);

    return null;
  },
);

