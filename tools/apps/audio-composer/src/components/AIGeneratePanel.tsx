import React, { useState, useCallback, useRef } from 'react';
import { AudioCraftClient } from '@vulkan-game-tools/ai-providers';
import { useComposerStore, LayerId } from '../store/useComposerStore.js';
import { AudioPlayerHandle } from './AudioPlayer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
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
// Prompt presets per layer
// ---------------------------------------------------------------------------
const PRESET_PROMPTS: Record<LayerId, string[]> = {
  bass: [
    'Low, rumbling bass drone with dark atmospheric undertones',
    'Deep electronic bass pulse, slow 120 BPM, ambient feel',
    'Warm sub-bass hum, fantasy dungeon atmosphere',
  ],
  harmony: [
    'Ethereal synth pad, lush harmonics, slow attack',
    'Fantasy orchestral strings, gentle and mysterious',
    'Warm choir voices, soft ambient texture',
  ],
  melody: [
    'Gentle folk flute melody, playful and light',
    'Fantasy harp melody, pentatonic scale, flowing',
    'Celtic tin whistle, upbeat exploration theme',
  ],
  percussion: [
    'Subtle tribal drums, 120 BPM, soft and atmospheric',
    'Light percussion loop, shakers and soft cymbal',
    'Fantasy taiko drum, distant rhythmic pulse',
  ],
};

// ---------------------------------------------------------------------------
// AIGeneratePanel
// ---------------------------------------------------------------------------
export function AIGeneratePanel({ playerRef }: AIGeneratePanelProps) {
  const [prompt, setPrompt] = useState('');
  const [targetLayer, setTargetLayer] = useState<LayerId>('melody');
  const [duration, setDuration] = useState(5);
  const [temperature, setTemperature] = useState(1.0);
  const [serverUrl, setServerUrl] = useState(import.meta.env.VITE_AUDIOCRAFT_URL || 'http://localhost:8001');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewBuffer, setPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const layers = useComposerStore((s) => s.layers);

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (status.kind === 'generating') return;

    setStatus({ kind: 'checking' });

    const client = new AudioCraftClient(serverUrl);
    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach AudioCraft at ${serverUrl}. Start the AudioCraft REST server on port 8001.`,
    }));

    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'AudioCraft unavailable' });
      return;
    }

    setStatus({ kind: 'generating', message: `Generating ${duration}s of audio…` });

    try {
      const audioData = await client.generateAudio(prompt, { duration, temperature });
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
  }, [prompt, duration, temperature, serverUrl, status]);

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
  // Status color / icon
  // -------------------------------------------------------------------------
  const statusMeta: Record<GenerationStatus['kind'], { color: string; icon: string }> = {
    idle:       { color: '#666',    icon: '' },
    checking:   { color: '#90c0f0', icon: '...' },
    generating: { color: '#90c0f0', icon: '⟳' },
    ready:      { color: '#70d870', icon: '✓' },
    error:      { color: '#e07070', icon: '✗' },
  };

  const isWorking = status.kind === 'checking' || status.kind === 'generating';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        AI Music Generation
        <span style={{ fontSize: 10, color: '#555', marginLeft: 6 }}>MusicGen</span>
      </div>

      <div style={styles.body}>
        {/* Layer selector */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Target Layer</div>
          <div style={styles.layerGrid}>
            {LAYER_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setTargetLayer(id)}
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

        {/* Prompt */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Music Description</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
            }}
            placeholder={`Describe the ${LAYER_LABELS[targetLayer].toLowerCase()} sound…`}
            rows={3}
            style={styles.textarea}
          />
          <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', marginTop: 2 }}>
            Ctrl+Enter to generate
          </div>
        </div>

        {/* Preset prompts */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Quick Presets</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {PRESET_PROMPTS[targetLayer].map((preset, i) => (
              <button
                key={i}
                onClick={() => setPrompt(preset)}
                style={styles.presetBtn}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
                  (e.currentTarget as HTMLButtonElement).style.color = '#aaa';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a2a';
                  (e.currentTarget as HTMLButtonElement).style.color = '#666';
                }}
              >
                {preset}
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
            max={10}
            step={1}
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            style={styles.slider}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 8, color: '#444' }}>
            <span>1s</span><span>5s</span><span>10s</span>
          </div>
        </div>

        {/* Advanced */}
        <div style={styles.field}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={styles.toggleBtn}
          >
            {showAdvanced ? '▼' : '▶'} Advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Temperature */}
              <div>
                <div style={{ ...styles.fieldLabel, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Temperature</span>
                  <span style={{ color: '#aaa' }}>{temperature.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={styles.slider}
                />
              </div>

              {/* Server URL */}
              <div>
                <div style={styles.fieldLabel}>AudioCraft Server URL</div>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  style={styles.input}
                />
              </div>
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={isWorking || !prompt.trim()}
          style={{
            ...styles.generateBtn,
            opacity: isWorking || !prompt.trim() ? 0.5 : 1,
          }}
        >
          {isWorking ? (
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
          ) : (
            '♪'
          )}
          {' '}
          {status.kind === 'checking' ? 'Checking server…' : status.kind === 'generating' ? 'Generating…' : 'Generate Audio'}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div style={{
            ...styles.statusBox,
            borderColor: statusMeta[status.kind].color + '44',
            color: statusMeta[status.kind].color,
          }}>
            <span style={{ marginRight: 4 }}>{statusMeta[status.kind].icon}</span>
            {'message' in status ? status.message : status.kind === 'ready' ? 'Audio ready to preview' : ''}
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
              {isPreviewPlaying ? '■ Stop' : '▶ Preview'}
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

        {/* Help */}
        <div style={styles.helpBox}>
          Requires AudioCraft server running locally.<br />
          <code style={{ color: '#4a7ad0' }}>pip install audiocraft</code><br />
          <code style={{ color: '#4a7ad0' }}>python -m audiocraft.server</code>
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
  textarea: {
    background: '#111',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#ccc',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '5px 7px',
    resize: 'vertical' as const,
    outline: 'none',
    lineHeight: 1.5,
  },
  presetBtn: {
    background: 'transparent',
    border: '1px solid #2a2a2a',
    borderRadius: 3,
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '3px 6px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    lineHeight: 1.4,
    transition: 'all 0.1s',
  },
  slider: {
    width: '100%',
    height: 3,
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#111',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#aaa',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 7px',
    outline: 'none',
  },
  toggleBtn: {
    background: 'transparent',
    border: 'none',
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 10,
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
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
