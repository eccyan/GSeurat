import { create } from 'zustand';
import { BRIDGE_WS_URL } from '@gseurat/engine-client';

// ---------------------------------------------------------------------------
// EmitterConfig matches the engine's EmitterConfig (types.ts)
// Extended with extra fields for the visual designer
// ---------------------------------------------------------------------------
export interface EmitterConfig {
  spawn_rate: number;
  min_lifetime: number;
  max_lifetime: number;
  min_velocity: [number, number];
  max_velocity: [number, number];
  acceleration: [number, number];
  start_size: number;
  end_size: number;
  start_color: [number, number, number, number];
  end_color: [number, number, number, number];
  atlas_tile: number;  // 0=Circle, 1=SoftGlow, 2=Spark, 3=SmokePuff, 4=Raindrop, 5=Snowflake
  z: number;
  spawn_offset_min: [number, number];
  spawn_offset_max: [number, number];
}

export interface EmitterEntry {
  id: number;
  name: string;
  config: EmitterConfig;
  // Engine-side sync
  engine_id?: number;
}

export interface ParticleStoreState {
  emitters: EmitterEntry[];
  selectedEmitterId: number | null;
  nextLocalId: number;

  // Engine connection
  engineConnected: boolean;
  engineUrl: string;
  autoSync: boolean;

  // Actions
  addEmitter: (name?: string, config?: Partial<EmitterConfig>) => void;
  removeEmitter: (id: number) => void;
  duplicateEmitter: (id: number) => void;
  selectEmitter: (id: number | null) => void;
  updateConfig: (id: number, patch: Partial<EmitterConfig>) => void;
  applyPreset: (preset: EmitterConfig, name: string) => void;
  setEngineConnected: (connected: boolean) => void;
  setEngineUrl: (url: string) => void;
  setAutoSync: (autoSync: boolean) => void;
  setEmitterEngineId: (localId: number, engineId: number) => void;

  // Serialization
  exportJson: () => string;
  importJson: (json: string) => void;
}

export const defaultEmitterConfig = (): EmitterConfig => ({
  spawn_rate: 20,
  min_lifetime: 0.8,
  max_lifetime: 1.5,
  min_velocity: [-0.3, -1.0],
  max_velocity: [0.3, -2.0],
  acceleration: [0.0, 0.2],
  start_size: 0.18,
  end_size: 0.06,
  start_color: [1.0, 0.7, 0.2, 1.0],
  end_color: [0.8, 0.2, 0.0, 0.0],
  atlas_tile: 1,
  z: 0.0,
  spawn_offset_min: [-0.2, -0.2],
  spawn_offset_max: [0.2, 0.2],
});

export const useParticleStore = create<ParticleStoreState>((set, get) => ({
  emitters: [
    {
      id: 1,
      name: 'Emitter 1',
      config: defaultEmitterConfig(),
    },
  ],
  selectedEmitterId: 1,
  nextLocalId: 2,
  engineConnected: false,
  engineUrl: BRIDGE_WS_URL,
  autoSync: false,

  addEmitter: (name, config) => {
    const { nextLocalId, emitters } = get();
    const newEntry: EmitterEntry = {
      id: nextLocalId,
      name: name ?? `Emitter ${nextLocalId}`,
      config: { ...defaultEmitterConfig(), ...(config ?? {}) },
    };
    set({
      emitters: [...emitters, newEntry],
      selectedEmitterId: nextLocalId,
      nextLocalId: nextLocalId + 1,
    });
  },

  removeEmitter: (id) => {
    const { emitters, selectedEmitterId } = get();
    const remaining = emitters.filter((e) => e.id !== id);
    const newSelected =
      selectedEmitterId === id
        ? (remaining[remaining.length - 1]?.id ?? null)
        : selectedEmitterId;
    set({ emitters: remaining, selectedEmitterId: newSelected });
  },

  duplicateEmitter: (id) => {
    const { emitters, nextLocalId } = get();
    const source = emitters.find((e) => e.id === id);
    if (!source) return;
    const newEntry: EmitterEntry = {
      id: nextLocalId,
      name: `${source.name} (copy)`,
      config: JSON.parse(JSON.stringify(source.config)) as EmitterConfig,
    };
    set({
      emitters: [...emitters, newEntry],
      selectedEmitterId: nextLocalId,
      nextLocalId: nextLocalId + 1,
    });
  },

  selectEmitter: (id) => set({ selectedEmitterId: id }),

  updateConfig: (id, patch) => {
    const { emitters } = get();
    set({
      emitters: emitters.map((e) =>
        e.id === id ? { ...e, config: { ...e.config, ...patch } } : e,
      ),
    });
  },

  applyPreset: (preset, name) => {
    const { selectedEmitterId, emitters } = get();
    if (selectedEmitterId === null) {
      // Create new emitter with preset
      const { nextLocalId } = get();
      set({
        emitters: [
          ...emitters,
          { id: nextLocalId, name, config: { ...preset } },
        ],
        selectedEmitterId: nextLocalId,
        nextLocalId: nextLocalId + 1,
      });
    } else {
      set({
        emitters: emitters.map((e) =>
          e.id === selectedEmitterId
            ? { ...e, name, config: { ...preset } }
            : e,
        ),
      });
    }
  },

  setEngineConnected: (connected) => set({ engineConnected: connected }),
  setEngineUrl: (url) => set({ engineUrl: url }),
  setAutoSync: (autoSync) => set({ autoSync }),
  setEmitterEngineId: (localId, engineId) => {
    const { emitters } = get();
    set({
      emitters: emitters.map((e) =>
        e.id === localId ? { ...e, engine_id: engineId } : e,
      ),
    });
  },

  exportJson: () => {
    const { emitters } = get();
    return JSON.stringify(emitters, null, 2);
  },

  importJson: (json) => {
    try {
      const parsed = JSON.parse(json) as EmitterEntry[];
      if (!Array.isArray(parsed)) throw new Error('Expected array');
      const maxId = parsed.reduce((m, e) => Math.max(m, e.id), 0);
      set({
        emitters: parsed,
        selectedEmitterId: parsed[0]?.id ?? null,
        nextLocalId: maxId + 1,
      });
    } catch (err) {
      console.error('[ParticleStore] importJson failed:', err);
    }
  },
}));
