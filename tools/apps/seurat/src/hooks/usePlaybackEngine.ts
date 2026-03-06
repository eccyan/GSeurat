import { useEffect, useRef } from 'react';
import { useSeuratStore } from '../store/useSeuratStore.js';
import { getClipDuration } from '../lib/frame-utils.js';

export function usePlaybackEngine() {
  const playbackState = useSeuratStore((s) => s.playbackState);
  const manifest = useSeuratStore((s) => s.manifest);
  const selectedClipName = useSeuratStore((s) => s.selectedClipName);
  const { setCurrentTime, setPlaybackState } = useSeuratStore();

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (playbackState !== 'playing') {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        lastTimeRef.current = null;
      }
      return;
    }

    const clip = manifest?.animations.find((a) => a.name === selectedClipName);
    const duration = clip ? getClipDuration(clip) : 0;

    const tick = (now: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = now;
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const store = useSeuratStore.getState();
      let t = store.currentTime + dt;

      if (clip?.loop) {
        if (duration > 0) t = t % duration;
      } else {
        if (t >= duration) {
          t = duration;
          setPlaybackState('stopped');
          setCurrentTime(t);
          return;
        }
      }

      setCurrentTime(t);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimeRef.current = null;
    };
  }, [playbackState, selectedClipName, manifest, setCurrentTime, setPlaybackState]);
}
