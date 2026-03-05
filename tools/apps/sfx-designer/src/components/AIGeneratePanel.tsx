import React, { useState, useCallback } from 'react';
import { AudioCraftClient } from '@vulkan-game-tools/ai-providers';
import { useSfxStore } from '../store/useSfxStore.js';
import { SFX_PRESETS } from '../audio/presets.js';
import { renderSfx, SAMPLE_RATE } from '../audio/synth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GenStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'generating'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Preset row
// ---------------------------------------------------------------------------

interface PresetRowProps {
  name: string;
  description: string;
  onLoad: () => void;
}

function PresetRow({ name, description, onLoad }: PresetRowProps) {
  return (
    <div style={styles.presetRow}>
      <div style={{ flex: 1 }}>
        <div style={styles.presetName}>{name}</div>
        <div style={styles.presetDesc}>{description}</div>
      </div>
      <button onClick={onLoad} style={styles.presetBtn} title="Load preset">
        LOAD
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AIGeneratePanel
// ---------------------------------------------------------------------------

export function AIGeneratePanel() {
  const store = useSfxStore();

  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(2);
  const [temperature, setTemperature] = useState(1.0);
  const [audioCraftUrl, setAudioCraftUrl] = useState(import.meta.env.VITE_AUDIOCRAFT_URL || 'http://localhost:8001');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<GenStatus>({ kind: 'idle' });

  // Load a named preset into the editor store
  const loadPreset = useCallback(
    (presetName: string) => {
      const preset = SFX_PRESETS.find((p) => p.name === presetName);
      if (!preset) return;

      // Generate IDs for new items
      const makeId = () => Math.random().toString(36).slice(2, 9);

      const oscillators = preset.oscillators.map((o) => ({ ...o, id: makeId() }));
      const filters = preset.filters.map((f) => ({ ...f, id: makeId() }));

      // Replace entire oscillators list
      // Use store internals via zustand's setState
      useSfxStore.setState({
        oscillators,
        filters,
        envelope: { ...preset.envelope },
        reverb: { ...preset.reverb },
        delay: { ...preset.delay },
        distortion: { ...preset.distortion },
      });

      // Render immediately
      const samples = renderSfx({
        oscillators,
        envelope: preset.envelope,
        filters,
        reverb: preset.reverb,
        delay: preset.delay,
        distortion: preset.distortion,
      });
      store.setGeneratedSamples(samples);
    },
    [store],
  );

  // Load AI buffer as synth base (convert to Float32 samples + store)
  const useAiAsBase = useCallback(async () => {
    const buf = store.aiGeneratedBuffer;
    if (!buf) return;

    try {
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(buf.slice(0));

      // Get mono samples
      const channelData = decoded.getChannelData(0);
      const samples = new Float32Array(channelData.length);
      samples.set(channelData);

      store.setGeneratedSamples(samples);
      setStatus({ kind: 'done', message: 'AI audio loaded as waveform. Adjust synth params to customize.' });
    } catch (e) {
      setStatus({ kind: 'error', message: `Could not decode AI audio: ${e instanceof Error ? e.message : e}` });
    }
  }, [store]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (status.kind === 'generating' || status.kind === 'checking') return;

    setStatus({ kind: 'checking' });

    const client = new AudioCraftClient(audioCraftUrl);

    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach AudioCraft at ${audioCraftUrl}. Start the AudioCraft REST server on port 8001.`,
    }));
    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'AudioCraft unavailable' });
      return;
    }

    setStatus({ kind: 'generating', message: `Generating "${prompt.trim()}"…` });

    try {
      const buffer = await client.generateAudio(prompt.trim(), { duration, temperature });
      store.setAiGeneratedBuffer(buffer);
      setStatus({ kind: 'done', message: `Generated ${duration}s of audio.` });
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [prompt, duration, temperature, audioCraftUrl, status.kind, store]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  const isGenerating = status.kind === 'generating' || status.kind === 'checking';

  const statusColor: Record<GenStatus['kind'], string> = {
    idle: '#555',
    checking: '#90b8e0',
    generating: '#90c0f0',
    done: '#70d870',
    error: '#e07070',
  };

  // Prompt quick-fill examples
  const EXAMPLE_PROMPTS = [
    'sword slash whoosh metal clang',
    'explosion rumble deep bass',
    'coin pickup jingle bright',
    'fire crackling ambient loop',
    'footstep stone dungeon',
    'magic spell sparkle chime',
  ];

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>AI GENERATE</span>
        <span style={styles.panelSubtitle}>AudioCraft</span>
      </div>

      <div style={styles.body}>
        {/* ---------------------------------------------------------------- */}
        {/* Built-in presets                                                 */}
        {/* ---------------------------------------------------------------- */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>BUILT-IN PRESETS</div>
          <div style={styles.presetList}>
            {SFX_PRESETS.map((p) => (
              <PresetRow
                key={p.name}
                name={p.name}
                description={p.description}
                onLoad={() => loadPreset(p.name)}
              />
            ))}
          </div>
        </div>

        <div style={styles.divider} />

        {/* ---------------------------------------------------------------- */}
        {/* AudioCraft generation                                            */}
        {/* ---------------------------------------------------------------- */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>AUDIOCRAFT GENERATION</div>

          {/* Prompt */}
          <div style={styles.fieldGroup}>
            <div style={styles.fieldLabel}>Prompt</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the sound effect…"
              rows={3}
              style={styles.textarea}
            />
            <div style={styles.hint}>Ctrl+Enter to generate</div>
          </div>

          {/* Quick prompt examples */}
          <div style={styles.exampleRow}>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                style={styles.exampleBtn}
              >
                {ex}
              </button>
            ))}
          </div>

          {/* Duration & temperature */}
          <div style={styles.fieldGroup}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={styles.fieldLabel}>Duration</span>
              <input
                type="range" min={0.5} max={10} step={0.5}
                value={duration}
                onChange={(e) => setDuration(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#9080e0' }}
              />
              <span style={styles.valueLabel}>{duration.toFixed(1)}s</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={styles.fieldLabel}>Temp</span>
              <input
                type="range" min={0.1} max={2.0} step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                style={{ flex: 1, accentColor: '#9080e0' }}
              />
              <span style={styles.valueLabel}>{temperature.toFixed(1)}</span>
            </div>
          </div>

          {/* Advanced: server URL */}
          <div style={styles.fieldGroup}>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              style={styles.advancedToggle}
            >
              {showAdvanced ? '▼' : '▶'} Advanced
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 6 }}>
                <div style={styles.fieldLabel}>AudioCraft URL</div>
                <input
                  type="text"
                  value={audioCraftUrl}
                  onChange={(e) => setAudioCraftUrl(e.target.value)}
                  style={styles.textInput}
                />
                <div style={{ ...styles.hint, marginTop: 4 }}>
                  Default: http://localhost:8001<br />
                  Needs POST /generate + GET /health endpoints.
                </div>
              </div>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            style={{
              ...styles.generateBtn,
              opacity: isGenerating || !prompt.trim() ? 0.6 : 1,
              background: isGenerating ? '#2a1a3a' : '#2a1a5a',
              borderColor: isGenerating ? '#7a4ab0' : '#6a4ae0',
            }}
          >
            {isGenerating ? 'Generating…' : 'Generate with AudioCraft'}
          </button>

          {/* Status */}
          {status.kind !== 'idle' && (
            <div style={{
              ...styles.statusBox,
              borderColor: `${statusColor[status.kind]}44`,
              color: statusColor[status.kind],
            }}>
              {status.kind === 'done' && 'OK: '}
              {status.kind === 'error' && 'ERR: '}
              {status.kind === 'generating' && '... '}
              {status.kind === 'checking' && 'checking: '}
              {'message' in status ? status.message : ''}
            </div>
          )}

          {/* AI result actions */}
          {store.aiGeneratedBuffer && status.kind === 'done' && (
            <div style={styles.aiActions}>
              <div style={styles.fieldLabel}>AI Result:</div>
              <button onClick={useAiAsBase} style={styles.aiActionBtn}>
                Use as Base Waveform
              </button>
              <div style={{ ...styles.hint, marginTop: 4 }}>
                Loads AI audio into waveform preview for export.
              </div>
            </div>
          )}
        </div>

        {/* Help */}
        <div style={styles.helpBox}>
          <div style={styles.helpTitle}>Setup AudioCraft</div>
          <div style={styles.helpText}>
            Run a local AudioCraft server exposing:<br />
            &nbsp;&nbsp;POST /generate &#123; prompt, duration, temperature &#125;<br />
            &nbsp;&nbsp;GET  /health → &#123; status: "ok" &#125;<br />
            <br />
            Returns raw audio bytes or JSON with audio_data (base64) / url.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    background: '#181825',
    height: '100%',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: '#1e1e2e',
    borderBottom: '1px solid #2a2a3a',
    flexShrink: 0,
  },
  panelTitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#9080c0',
    fontWeight: 700,
    letterSpacing: '0.08em',
  },
  panelSubtitle: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#504080',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#505070',
    fontWeight: 700,
    letterSpacing: '0.1em',
    marginBottom: 2,
  },
  presetList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  presetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 8px',
    background: '#1e1e2e',
    border: '1px solid #2a2a4a',
    borderRadius: 4,
  },
  presetName: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#9090c0',
    fontWeight: 600,
  },
  presetDesc: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#505060',
    marginTop: 1,
  },
  presetBtn: {
    background: '#2a2a4a',
    border: '1px solid #4a4a8a',
    borderRadius: 3,
    color: '#7070c0',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  divider: {
    borderTop: '1px solid #2a2a3a',
    margin: '2px 0',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  fieldLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#606080',
    letterSpacing: '0.04em',
  },
  textarea: {
    background: '#1a1a2a',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#c0c0e0',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 8px',
    resize: 'vertical' as const,
    outline: 'none',
    lineHeight: 1.5,
    minHeight: 60,
  },
  textInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#1a1a2a',
    border: '1px solid #333',
    borderRadius: 3,
    color: '#a0a0c0',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '4px 7px',
    outline: 'none',
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#404050',
    lineHeight: 1.5,
  },
  exampleRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  exampleBtn: {
    background: 'transparent',
    border: '1px solid #2a2a4a',
    borderRadius: 3,
    color: '#505070',
    fontFamily: 'monospace',
    fontSize: 9,
    padding: '2px 5px',
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  valueLabel: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#8080a0',
    minWidth: 32,
    textAlign: 'right' as const,
  },
  advancedToggle: {
    background: 'transparent',
    border: 'none',
    color: '#505070',
    fontFamily: 'monospace',
    fontSize: 10,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  generateBtn: {
    width: '100%',
    padding: '8px 0',
    borderRadius: 5,
    borderStyle: 'solid',
    borderWidth: 1,
    color: '#b0a0f0',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.04em',
    transition: 'all 0.15s',
  },
  statusBox: {
    padding: '6px 8px',
    background: '#161620',
    border: '1px solid',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    lineHeight: 1.5,
  },
  aiActions: {
    padding: '8px',
    background: '#1e1e2e',
    border: '1px solid #2a2a4a',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  aiActionBtn: {
    background: '#2a2a4a',
    border: '1px solid #4a4a8a',
    borderRadius: 4,
    color: '#9090d0',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 0',
    cursor: 'pointer',
    fontWeight: 600,
  },
  helpBox: {
    padding: '8px 10px',
    background: '#161620',
    border: '1px solid #252535',
    borderRadius: 4,
  },
  helpTitle: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#505070',
    fontWeight: 700,
    marginBottom: 5,
  },
  helpText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#404050',
    lineHeight: 1.7,
  },
};
