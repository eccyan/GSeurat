import { useCallback, useRef } from 'react';
import { EngineClient } from '@gseurat/engine-client';
import type { EmittersResponse } from '@gseurat/engine-client';
import { useParticleStore } from '../store/useParticleStore.js';
import type { EmitterConfig } from '../store/useParticleStore.js';

/**
 * Hook that provides engine communication helpers for the particle designer.
 */
export function useEngine() {
  const clientRef = useRef<EngineClient | null>(null);
  const { setEngineConnected, engineUrl } = useParticleStore();

  const getClient = useCallback((): EngineClient => {
    if (!clientRef.current) {
      clientRef.current = new EngineClient(engineUrl);
    }
    return clientRef.current;
  }, [engineUrl]);

  const connect = useCallback(async () => {
    try {
      const client = getClient();
      await client.connect();
      setEngineConnected(true);
    } catch {
      setEngineConnected(false);
    }
  }, [getClient, setEngineConnected]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setEngineConnected(false);
  }, [setEngineConnected]);

  const listEmitters = useCallback(async (): Promise<EmittersResponse | null> => {
    const client = getClient();
    if (!client.isConnected) return null;
    try {
      return await client.send<EmittersResponse>({ cmd: 'list_emitters' });
    } catch {
      return null;
    }
  }, [getClient]);

  const setEmitterConfig = useCallback(
    async (emitter_id: number, config: EmitterConfig): Promise<void> => {
      const client = getClient();
      if (!client.isConnected) return;
      try {
        await client.send({
          cmd: 'set_emitter_config',
          emitter_id,
          config: {
            spawn_rate: config.spawn_rate,
            min_velocity: config.min_velocity,
            max_velocity: config.max_velocity,
            min_lifetime: config.min_lifetime,
            max_lifetime: config.max_lifetime,
            start_color: config.start_color,
            end_color: config.end_color,
            start_size: config.start_size,
            end_size: config.end_size,
            atlas_tile: config.atlas_tile,
          },
        });
      } catch (err) {
        console.error('[useEngine] setEmitterConfig failed:', err);
      }
    },
    [getClient],
  );

  const addEmitter = useCallback(
    async (x: number, y: number, config: EmitterConfig): Promise<number | null> => {
      const client = getClient();
      if (!client.isConnected) return null;
      try {
        const resp = await client.send<{ type: string; emitter_id?: number }>({
          cmd: 'add_emitter',
          x,
          y,
          config: {
            spawn_rate: config.spawn_rate,
            min_velocity: config.min_velocity,
            max_velocity: config.max_velocity,
            min_lifetime: config.min_lifetime,
            max_lifetime: config.max_lifetime,
            start_color: config.start_color,
            end_color: config.end_color,
            start_size: config.start_size,
            end_size: config.end_size,
            atlas_tile: config.atlas_tile,
          },
        });
        return resp.emitter_id ?? null;
      } catch {
        return null;
      }
    },
    [getClient],
  );

  const removeEmitter = useCallback(
    async (emitter_id: number): Promise<void> => {
      const client = getClient();
      if (!client.isConnected) return;
      try {
        await client.send({ cmd: 'remove_emitter', emitter_id });
      } catch {
        // ignore
      }
    },
    [getClient],
  );

  return { connect, disconnect, listEmitters, setEmitterConfig, addEmitter, removeEmitter };
}
