/**
 * Hook that watches the store's saGenerateRequestId / saApplyRequestId
 * and triggers Stable Audio generation / layer application.
 *
 * Must be mounted at the App level (always rendered) so remote
 * WebSocket commands work regardless of which tab is active.
 */
import { useEffect, useRef } from 'react';
import { StableAudioClient } from '@gseurat/ai-providers';
import { useComposerStore } from '../store/useComposerStore.js';
import type { AudioPlayerHandle } from '../components/AudioPlayer.js';

const STABLE_AUDIO_URL = (import.meta as any).env?.VITE_STABLE_AUDIO_URL as string | undefined;

export function useSaRemoteGeneration(
  playerRef: React.RefObject<AudioPlayerHandle | null>,
) {
  const saGenerateRequestId = useComposerStore((s) => s.saGenerateRequestId);
  const saApplyRequestId = useComposerStore((s) => s.saApplyRequestId);

  const audioDataRef = useRef<ArrayBuffer | null>(null);
  const lastGenRef = useRef(0);
  const lastApplyRef = useRef(0);

  // Watch for remote generate requests
  useEffect(() => {
    if (saGenerateRequestId === 0) return;
    if (saGenerateRequestId === lastGenRef.current) return;
    lastGenRef.current = saGenerateRequestId;

    if (!STABLE_AUDIO_URL) {
      useComposerStore.getState().setSaStatus('error', 'VITE_STABLE_AUDIO_URL not configured');
      return;
    }

    const { saPrompt, saDuration } = useComposerStore.getState();
    if (!saPrompt.trim()) {
      useComposerStore.getState().setSaStatus('error', 'Empty prompt');
      return;
    }

    useComposerStore.getState().setSaStatus('generating');

    (async () => {
      try {
        const client = new StableAudioClient(STABLE_AUDIO_URL);
        const audioData = await client.generateAudio(saPrompt.trim(), { duration: saDuration });
        audioDataRef.current = audioData;
        useComposerStore.getState().setSaStatus('ready');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useComposerStore.getState().setSaStatus('error', msg);
      }
    })();
  }, [saGenerateRequestId]);

  // Watch for remote apply requests
  useEffect(() => {
    if (saApplyRequestId === 0) return;
    if (saApplyRequestId === lastApplyRef.current) return;
    lastApplyRef.current = saApplyRequestId;

    const { saTargetLayer } = useComposerStore.getState();
    const audioData = audioDataRef.current;
    if (!audioData) {
      useComposerStore.getState().setSaStatus('error', 'No audio data to apply');
      return;
    }

    (async () => {
      try {
        await playerRef.current?.loadLayerBuffer(saTargetLayer, audioData);
        audioDataRef.current = null;
        useComposerStore.getState().setSaStatus('idle');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        useComposerStore.getState().setSaStatus('error', msg);
      }
    })();
  }, [saApplyRequestId, playerRef]);
}
