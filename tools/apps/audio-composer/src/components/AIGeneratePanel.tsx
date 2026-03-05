import React, { useState, useCallback, useRef } from 'react';
import { ReplicateClient } from '@vulkan-game-tools/ai-providers';
import { useComposerStore, LayerId } from '../store/useComposerStore.js';
import { AudioPlayerHandle } from './AudioPlayer.js';
import { LOOP_PRESETS, MusicLoopPreset, LoopStyle } from '../audio/music-presets.js';
import { generateLoop } from '../audio/loop-generator.js';

const REPLICATE_TOKEN = (import.meta as any).env?.VITE_REPLICATE_API_TOKEN as string | undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'ready'; audioData: ArrayBuffer }
  | { kind: 'error'; message: string };

interface AIGeneratePanelProps {
  playerRef: React.RefObject<AudioPlayerHandle | null>;
}

const LAYER_IDS: LayerId[] = ['bass', 'harmony', 'melody', 'percussion'];
const LAYER_LABELS: Record<LayerId, string> = {
  bass: 'Bass Drone',
  harmony: 'Harmony Pad',
  melody: 'Melody',
  percussion: 'Percussion',
};
const LAYER_COLORS: Record<LayerId, string> = {
  bass: '#4a6aff',
  harmony: '#a040e0',
  melody: '#40b870',
  percussion: '#e07040',
};

// ---------------------------------------------------------------------------
// AIGeneratePanel
// ---------------------------------------------------------------------------
export function AIGeneratePanel({ playerRef }: AIGeneratePanelProps) {
  const [targetLayer, setTargetLayer] = useState<LayerId>('melody');
  const [selectedPreset, setSelectedPreset] = useState<LoopStyle | null>(null);
  const [duration, setDuration] = useState(4);
  const [status, setStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewBuffer, setPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // AI generation state (optional)
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDuration, setAiDuration] = useState(5);
  const [aiStatus, setAiStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const aiPreviewCtxRef = useRef<AudioContext | null>(null);
  const aiPreviewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [aiPreviewBuffer, setAiPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [isAiPreviewPlaying, setIsAiPreviewPlaying] = useState(false);

  const bpm = useComposerStore((s) => s.bpm);

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------
  const handleGenerate = useCallback(async () => {
    if (!selectedPreset) return;
    if (status.kind === 'generating') return;

    setStatus({ kind: 'generating', message: `Generating ${duration}s loop...` });

    try {
      const audioData = await generateLoop({
        style: selectedPreset,
        duration,
        bpm,
      });
      setStatus({ kind: 'ready', audioData });

      // Decode for preview
      const ctx = new AudioContext();
      previewCtxRef.current = ctx;
      const decoded = await ctx.decodeAudioData(audioData.slice(0));
      setPreviewBuffer(decoded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: msg });
    }
  }, [selectedPreset, duration, bpm, status]);

  // -------------------------------------------------------------------------
  // Preview playback
  // -------------------------------------------------------------------------
  const handlePreviewPlay = useCallback(() => {
    if (!previewBuffer || !previewCtxRef.current) return;

    if (isPreviewPlaying) {
      previewSourceRef.current?.stop();
      setIsPreviewPlaying(false);
      return;
    }

    const ctx = previewCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const src = ctx.createBufferSource();
    src.buffer = previewBuffer;
    src.connect(ctx.destination);
    src.start();
    src.onended = () => setIsPreviewPlaying(false);
    previewSourceRef.current = src;
    setIsPreviewPlaying(true);
  }, [previewBuffer, isPreviewPlaying]);

  // -------------------------------------------------------------------------
  // Apply to lane
  // -------------------------------------------------------------------------
  const handleApplyToLane = useCallback(async () => {
    if (status.kind !== 'ready') return;
    await playerRef.current?.loadLayerBuffer(targetLayer, status.audioData);
    setStatus({ kind: 'idle' });
    setPreviewBuffer(null);
    setIsPreviewPlaying(false);
  }, [status, targetLayer, playerRef]);

  // -------------------------------------------------------------------------
  // AI generation via Replicate
  // -------------------------------------------------------------------------
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || !REPLICATE_TOKEN) return;
    if (aiStatus.kind === 'generating') return;

    setAiStatus({ kind: 'generating', message: `Generating ${aiDuration}s via AI...` });
    try {
      const client = new ReplicateClient(REPLICATE_TOKEN);
      const audioData = await client.generateAudio(aiPrompt.trim(), { duration: aiDuration });
      setAiStatus({ kind: 'ready', audioData });

      const ctx = new AudioContext();
      aiPreviewCtxRef.current = ctx;
      const decoded = await ctx.decodeAudioData(audioData.slice(0));
      setAiPreviewBuffer(decoded);
    } catch (err) {
      setAiStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [aiPrompt, aiDuration, aiStatus.kind]);

  const handleAiPreviewPlay = useCallback(() => {
    if (!aiPreviewBuffer || !aiPreviewCtxRef.current) return;
    if (isAiPreviewPlaying) {
      aiPreviewSourceRef.current?.stop();
      setIsAiPreviewPlaying(false);
      return;
    }
    const ctx = aiPreviewCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = aiPreviewBuffer;
    src.connect(ctx.destination);
    src.start();
    src.onended = () => setIsAiPreviewPlaying(false);
    aiPreviewSourceRef.current = src;
    setIsAiPreviewPlaying(true);
  }, [aiPreviewBuffer, isAiPreviewPlaying]);

  const handleAiApplyToLane = useCallback(async () => {
    if (aiStatus.kind !== 'ready') return;
    await playerRef.current?.loadLayerBuffer(targetLayer, aiStatus.audioData);
    setAiStatus({ kind: 'idle' });
    setAiPreviewBuffer(null);
    setIsAiPreviewPlaying(false);
  }, [aiStatus, targetLayer, playerRef]);

  // -------------------------------------------------------------------------
  // Status color / icon
  // -------------------------------------------------------------------------
  const statusMeta: Record<GenerationStatus['kind'], { color: string; icon: string }> = {
    idle:       { color: '#666',    icon: '' },
    generating: { color: '#90c0f0', icon: '...' },
    ready:      { color: '#70d870', icon: '' },
    error:      { color: '#e07070', icon: '' },
  };

  const isWorking = status.kind === 'generating';
  const presets = LOOP_PRESETS[targetLayer];

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        Procedural Generation
      </div>

      <div style={styles.body}>
        {/* Layer selector */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Target Layer</div>
          <div style={styles.layerGrid}>
            {LAYER_IDS.map((id) => (
              <button
                key={id}
                onClick={() => { setTargetLayer(id); setSelectedPreset(null); }}
                style={{
                  ...styles.layerBtn,
                  background: targetLayer === id ? LAYER_COLORS[id] + '22' : 'transparent',
                  borderColor: targetLayer === id ? LAYER_COLORS[id] : '#333',
                  color: targetLayer === id ? LAYER_COLORS[id] : '#666',
                }}
              >
                {LAYER_LABELS[id]}
              </button>
            ))}
          </div>
        </div>

        {/* Preset list */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Style</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {presets.map((preset: MusicLoopPreset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPreset(preset.id)}
                style={{
                  ...styles.presetBtn,
                  borderColor: selectedPreset === preset.id ? LAYER_COLORS[targetLayer] : '#2a2a2a',
                  color: selectedPreset === preset.id ? '#ccc' : '#666',
                  background: selectedPreset === preset.id ? LAYER_COLORS[targetLayer] + '15' : 'transparent',
                }}
              >
                <strong>{preset.label}</strong>
                <span style={{ marginLeft: 6, fontSize: 8, color: '#555' }}>{preset.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Duration slider */}
        <div style={styles.field}>
          <div style={{ ...styles.fieldLabel, display: 'flex', justifyContent: 'space-between' }}>
            <span>Duration</span>
            <span style={{ color: '#aaa' }}>{duration}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            style={styles.slider}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 8, color: '#444' }}>
            <span>1s</span><span>8s</span><span>16s</span>
          </div>
        </div>

        {/* BPM display */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>BPM: {bpm}</div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isWorking || !selectedPreset}
          style={{
            ...styles.generateBtn,
            opacity: isWorking || !selectedPreset ? 0.5 : 1,
          }}
        >
          {isWorking ? 'Generating...' : 'Generate Loop'}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div style={{
            ...styles.statusBox,
            borderColor: statusMeta[status.kind].color + '44',
            color: statusMeta[status.kind].color,
          }}>
            <span style={{ marginRight: 4 }}>{statusMeta[status.kind].icon}</span>
            {'message' in status ? status.message : status.kind === 'ready' ? 'Loop ready to preview' : ''}
          </div>
        )}

        {/* Preview / Apply */}
        {status.kind === 'ready' && previewBuffer && (
          <div style={styles.previewRow}>
            <button
              onClick={handlePreviewPlay}
              style={{
                ...styles.previewBtn,
                background: isPreviewPlaying ? '#2a3a5a' : '#1a1a1a',
                borderColor: isPreviewPlaying ? '#4a6ab8' : '#333',
                color: isPreviewPlaying ? '#90b8f8' : '#888',
                flex: 1,
              }}
            >
              {isPreviewPlaying ? 'Stop' : 'Preview'}
            </button>
            <button
              onClick={handleApplyToLane}
              style={{
                ...styles.previewBtn,
                background: '#1a2a1a',
                borderColor: '#2a5a2a',
                color: '#70d070',
                flex: 1,
              }}
            >
              Apply to {LAYER_LABELS[targetLayer]}
            </button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* AI Generation (optional — Replicate)                             */}
        {/* ---------------------------------------------------------------- */}
        {REPLICATE_TOKEN && (
          <>
            <div style={{ borderTop: '1px solid #2a2a2a', margin: '4px 0' }} />
            <div style={styles.field}>
              <div style={{ ...styles.fieldLabel, color: '#888' }}>AI GENERATION (REPLICATE)</div>

              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAiGenerate();
                  }
                }}
                placeholder={`Describe the ${LAYER_LABELS[targetLayer].toLowerCase()} sound for AI...`}
                rows={2}
                style={styles.textarea}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.fieldLabel }}>
                <span>Duration</span>
                <span style={{ color: '#aaa' }}>{aiDuration}s</span>
              </div>
              <input
                type="range" min={1} max={30} step={1}
                value={aiDuration}
                onChange={(e) => setAiDuration(parseInt(e.target.value))}
                style={styles.slider}
              />

              <button
                onClick={handleAiGenerate}
                disabled={aiStatus.kind === 'generating' || !aiPrompt.trim()}
                style={{
                  ...styles.generateBtn,
                  background: '#2a1a3a',
                  borderColor: '#4a2a6a',
                  color: '#b090e0',
                  opacity: aiStatus.kind === 'generating' || !aiPrompt.trim() ? 0.5 : 1,
                }}
              >
                {aiStatus.kind === 'generating' ? 'Generating via AI...' : 'Generate with AI'}
              </button>

              {aiStatus.kind !== 'idle' && (
                <div style={{
                  ...styles.statusBox,
                  borderColor: statusMeta[aiStatus.kind].color + '44',
                  color: statusMeta[aiStatus.kind].color,
                }}>
                  {'message' in aiStatus ? aiStatus.message : aiStatus.kind === 'ready' ? 'AI audio ready' : ''}
                </div>
              )}

              {aiStatus.kind === 'ready' && aiPreviewBuffer && (
                <div style={styles.previewRow}>
                  <button
                    onClick={handleAiPreviewPlay}
                    style={{
                      ...styles.previewBtn,
                      background: isAiPreviewPlaying ? '#2a3a5a' : '#1a1a1a',
                      borderColor: isAiPreviewPlaying ? '#4a6ab8' : '#333',
                      color: isAiPreviewPlaying ? '#90b8f8' : '#888',
                      flex: 1,
                    }}
                  >
                    {isAiPreviewPlaying ? 'Stop' : 'Preview'}
                  </button>
                  <button
                    onClick={handleAiApplyToLane}
                    style={{
                      ...styles.previewBtn,
                      background: '#1a2a1a',
                      borderColor: '#2a5a2a',
                      color: '#70d070',
                      flex: 1,
                    }}
                  >
                    Apply to {LAYER_LABELS[targetLayer]}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Help */}
        <div style={styles.helpBox}>
          Generates loops procedurally in the browser.<br />
          No server required — uses OfflineAudioContext synthesis.
          {!REPLICATE_TOKEN && (
            <>
              <br /><br />
              Set <code style={{ color: '#4a7ad0' }}>VITE_REPLICATE_API_TOKEN</code> in tools/.env for optional AI generation via Replicate.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    background: '#161616',
    borderTop: '1px solid #222',
    overflow: 'hidden',
    flex: 1,
  },
  header: {
    padding: '7px 10px',
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: '#1a1a1a',
    borderBottom: '1px solid #222',
    display: 'flex',
    alignItems: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fieldLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  layerGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 4,
  },
  layerBtn: {
    padding: '4px 6px',
    border: '1px solid #333',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    cursor: 'pointer',
    transition: 'all 0.1s',
  },
  presetBtn: {
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 3,
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '4px 6px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    lineHeight: 1.4,
    transition: 'all 0.1s',
    display: 'flex',
    alignItems: 'baseline',
  },
  slider: {
    width: '100%',
    height: 3,
    cursor: 'pointer',
  },
  generateBtn: {
    padding: '8px 0',
    background: '#1a2a3a',
    border: '1px solid #2a4a6a',
    borderRadius: 4,
    color: '#70a0e0',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  statusBox: {
    padding: '5px 8px',
    background: '#111',
    border: '1px solid #333',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
  },
  previewRow: {
    display: 'flex',
    gap: 6,
  },
  previewBtn: {
    padding: '5px 8px',
    border: '1px solid #333',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  helpBox: {
    padding: '6px 8px',
    background: '#111',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#444',
    lineHeight: 1.7,
  },
};
