import React, { useState, useCallback, useRef } from 'react';
import { OllamaClient } from '@gseurat/ai-providers';
import { useParticleStore } from '../store/useParticleStore.js';
import type { EmitterConfig } from '../store/useParticleStore.js';

// ---------------------------------------------------------------------------
// System prompt for EmitterConfig generation
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a particle VFX designer for an HD-2D Vulkan game engine.
Generate an EmitterConfig JSON object when given a natural language description of a particle effect.

The JSON must strictly follow this schema:
{
  "spawn_rate": <number 0-200, particles per second>,
  "min_lifetime": <number 0.05-10, seconds>,
  "max_lifetime": <number 0.05-10, seconds>,
  "min_velocity": [<x: -10..10>, <y: -10..10>],
  "max_velocity": [<x: -10..10>, <y: -10..10>],
  "acceleration": [<x: -5..5>, <y: -5..5>],
  "start_size": <number 0.01-1.0, world units>,
  "end_size": <number 0.0-1.0, world units>,
  "start_color": [<r 0-1>, <g 0-1>, <b 0-1>, <a 0-1>],
  "end_color": [<r 0-1>, <g 0-1>, <b 0-1>, <a 0-1>],
  "atlas_tile": <integer: 0=Circle, 1=SoftGlow, 2=Spark, 3=SmokePuff, 4=Raindrop, 5=Snowflake>,
  "z": <number -1..1, depth bias>,
  "spawn_offset_min": [<x: -8..8>, <y: -8..8>],
  "spawn_offset_max": [<x: -8..8>, <y: -8..8>]
}

Coordinate system:
- Y+ velocity = upward in-game (canvas inverts this for preview)
- Colors are normalized 0-1 floats
- Size is in world units (0.15-0.25 is typical for an ember)

Return ONLY the JSON object, no explanation or markdown fences.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Quick-inspire prompts
// ---------------------------------------------------------------------------
const INSPIRE_PROMPTS = [
  'campfire sparks rising in the wind',
  'magical healing aura with green sparkles',
  'icy blizzard particles swirling around',
  'lava bubbles popping upward',
  'firefly lights drifting in a forest',
  'electric blue lightning sparks',
  'golden confetti celebration burst',
  'underwater bubbles rising slowly',
];

// ---------------------------------------------------------------------------
// AIAssistPanel
// ---------------------------------------------------------------------------
interface AIAssistPanelProps {
  onClose?: () => void;
}

export function AIAssistPanel({ onClose }: AIAssistPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [modelName, setModelName] = useState(import.meta.env.VITE_OLLAMA_MODEL || 'llama3');
  const [ollamaUrl, setOllamaUrl] = useState(import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434');
  const [status, setStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastJson, setLastJson] = useState<string | null>(null);
  const [generatedConfig, setGeneratedConfig] = useState<EmitterConfig | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const applyPreset = useParticleStore((s) => s.applyPreset);
  const addEmitter = useParticleStore((s) => s.addEmitter);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (status.kind === 'generating') {
      abortRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'generating', message: 'Connecting to Ollama...' });

    const client = new OllamaClient(ollamaUrl, modelName);

    const check = await client.checkAvailability().catch(() => ({
      available: false,
      error: `Cannot reach Ollama at ${ollamaUrl}. Start it with: ollama serve`,
    }));
    if (!check.available) {
      setStatus({ kind: 'error', message: check.error ?? 'Ollama unavailable' });
      return;
    }

    setStatus({ kind: 'generating', message: `Generating with ${modelName}...` });

    try {
      const response = await client.generate(prompt, {
        system: SYSTEM_PROMPT,
        temperature: 0.7,
        maxTokens: 512,
      });

      setStatus({ kind: 'generating', message: 'Parsing EmitterConfig JSON...' });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in model response.');
      }

      const raw = jsonMatch[0];
      setLastJson(raw);

      const parsed = JSON.parse(raw) as Partial<EmitterConfig>;
      const config = normalizeConfig(parsed);
      setGeneratedConfig(config);

      setStatus({ kind: 'success', message: `Config generated with ${modelName}.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: msg });
    }
  }, [prompt, modelName, ollamaUrl, status]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  const handleApply = useCallback(() => {
    if (!generatedConfig) return;
    applyPreset(generatedConfig, prompt.trim().slice(0, 40) || 'AI Emitter');
  }, [generatedConfig, applyPreset, prompt]);

  const handleApplyAsNew = useCallback(() => {
    if (!generatedConfig) return;
    addEmitter(prompt.trim().slice(0, 40) || 'AI Emitter', generatedConfig);
  }, [generatedConfig, addEmitter, prompt]);

  const isGenerating = status.kind === 'generating';

  const statusColor: Record<GenerationStatus['kind'], string> = {
    idle: '#666',
    generating: '#90c0f0',
    success: '#70d870',
    error: '#e07070',
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontWeight: 700, color: '#c0a0ff', fontFamily: 'monospace', fontSize: 11 }}>
          AI VFX Assist
        </span>
        {onClose && (
          <button onClick={onClose} style={styles.closeBtn}>x</button>
        )}
      </div>

      <div style={styles.body}>
        {/* Prompt textarea */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Effect Description</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the particle effect (e.g. 'campfire sparks rising in the wind')"
            rows={3}
            style={styles.textarea}
          />
          <div style={styles.hint}>Ctrl+Enter to generate</div>
        </div>

        {/* Inspire prompts */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Quick Inspire</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {INSPIRE_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                style={styles.inspireBtn}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#5a3a8a';
                  (e.currentTarget as HTMLButtonElement).style.color = '#c0a0ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a3a';
                  (e.currentTarget as HTMLButtonElement).style.color = '#777';
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Model selection */}
        <div style={styles.field}>
          <div style={styles.fieldLabel}>Model</div>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={styles.input}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
            {['llama3', 'mistral', 'codellama', 'gemma'].map((m) => (
              <button
                key={m}
                onClick={() => setModelName(m)}
                style={{
                  background: modelName === m ? '#2a1a4a' : '#1a1a2a',
                  border: modelName === m ? '1px solid #6040a0' : '1px solid #2a2a3a',
                  borderRadius: 3,
                  color: modelName === m ? '#a080e0' : '#555',
                  fontFamily: 'monospace',
                  fontSize: 9,
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced: Ollama URL */}
        <div style={styles.field}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={styles.advancedToggle}
          >
            <span>{showAdvanced ? '▼' : '▶'}</span>
            Advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 6 }}>
              <div style={styles.fieldLabel}>Ollama URL</div>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                style={styles.input}
              />
            </div>
          )}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          style={{
            width: '100%',
            padding: '8px 0',
            background: isGenerating ? '#3a1a2a' : '#2a1a4a',
            border: isGenerating ? '1px solid #8a3a5a' : '1px solid #6040a0',
            borderRadius: 5,
            color: isGenerating ? '#e08090' : '#b080ff',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          {isGenerating ? 'Cancel' : 'Generate Config'}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div style={{
            padding: '6px 8px',
            background: '#141420',
            border: `1px solid ${statusColor[status.kind]}44`,
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 10,
            color: statusColor[status.kind],
            lineHeight: 1.5,
            marginBottom: 8,
          }}>
            {status.message}
          </div>
        )}

        {/* Generated config actions */}
        {generatedConfig && status.kind === 'success' && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={handleApply}
              style={{ ...styles.actionBtn, flex: 1, background: '#2a1a4a', borderColor: '#6040a0', color: '#b080ff' }}
            >
              Apply to Selected
            </button>
            <button
              onClick={handleApplyAsNew}
              style={{ ...styles.actionBtn, flex: 1, background: '#1a2a1a', borderColor: '#407040', color: '#80c080' }}
            >
              Add as New
            </button>
          </div>
        )}

        {/* JSON preview */}
        {lastJson && (
          <details style={{ marginBottom: 8 }}>
            <summary style={{
              fontFamily: 'monospace',
              fontSize: 10,
              color: '#555',
              cursor: 'pointer',
            }}>
              Raw JSON ({lastJson.length} chars)
            </summary>
            <textarea
              readOnly
              value={lastJson}
              rows={8}
              style={{
                ...styles.textarea,
                color: '#555',
                fontSize: 9,
                marginTop: 4,
              }}
            />
          </details>
        )}

        {/* Help */}
        <div style={{
          padding: '6px 8px',
          background: '#141420',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 9,
          color: '#444',
          lineHeight: 1.6,
        }}>
          Requires Ollama running locally.<br />
          Install: <span style={{ color: '#6040a0' }}>ollama.com</span><br />
          Pull: <code>ollama pull llama3</code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Normalize config — fill in defaults for any missing fields
// ---------------------------------------------------------------------------
function normalizeConfig(raw: Partial<EmitterConfig>): EmitterConfig {
  const d: EmitterConfig = {
    spawn_rate: raw.spawn_rate ?? 20,
    min_lifetime: raw.min_lifetime ?? 0.8,
    max_lifetime: raw.max_lifetime ?? 1.5,
    min_velocity: (raw.min_velocity as [number, number]) ?? [-0.3, -1.0],
    max_velocity: (raw.max_velocity as [number, number]) ?? [0.3, -2.0],
    acceleration: (raw.acceleration as [number, number]) ?? [0, 0.1],
    start_size: raw.start_size ?? 0.18,
    end_size: raw.end_size ?? 0.05,
    start_color: (raw.start_color as [number, number, number, number]) ?? [1, 0.7, 0.2, 1],
    end_color: (raw.end_color as [number, number, number, number]) ?? [0.8, 0.1, 0, 0],
    atlas_tile: raw.atlas_tile ?? 1,
    z: raw.z ?? 0,
    spawn_offset_min: (raw.spawn_offset_min as [number, number]) ?? [-0.2, -0.2],
    spawn_offset_max: (raw.spawn_offset_max as [number, number]) ?? [0.2, 0.2],
  };
  // Clamp atlas_tile to valid range
  d.atlas_tile = Math.max(0, Math.min(5, Math.round(d.atlas_tile)));
  return d;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    background: '#0f0f1a',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    background: '#1a1826',
    borderBottom: '1px solid #2a2a3a',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 13,
    padding: '0 4px',
  },
  body: {
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflow: 'auto',
    flex: 1,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
  },
  fieldLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#777',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#444',
    marginTop: 2,
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#1a1a2a',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '6px 8px',
    resize: 'vertical' as const,
    outline: 'none',
    lineHeight: 1.5,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: '#1a1a2a',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '5px 8px',
    outline: 'none',
  },
  inspireBtn: {
    background: 'transparent',
    border: '1px solid #2a2a3a',
    borderRadius: 3,
    color: '#777',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '3px 6px',
    cursor: 'pointer',
    textAlign: 'left',
    lineHeight: 1.4,
  },
  advancedToggle: {
    background: 'transparent',
    border: 'none',
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 10,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  actionBtn: {
    padding: '6px 0',
    border: '1px solid',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
