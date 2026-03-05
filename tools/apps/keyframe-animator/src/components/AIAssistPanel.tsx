import React, { useState, useCallback, useRef } from 'react';
import { OllamaClient } from '@vulkan-game-tools/ai-providers';
import { useAnimatorStore, AnimClip, AnimFrame } from '../store/useAnimatorStore.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an animation designer for an HD-2D Vulkan game engine.
Generate sprite animation clip definitions as a JSON array when given a natural language description.

The JSON must strictly follow this schema:
[
  {
    "id": "<unique_string_id>",
    "name": "<clip_name>",
    "loop": <true|false>,
    "frames": [
      { "id": "<unique_string_id>", "tile_id": <integer>, "duration": <float_seconds> }
    ]
  }
]

Engine animation conventions:
- Tile IDs are zero-indexed in the sprite sheet, row-major (left-to-right, top-to-bottom)
- A 12-row sprite sheet (4 columns each) has clips: idle_south(row0), idle_north(row1), idle_east(row2), idle_west(row3), walk_south(row4), walk_north(row5), walk_east(row6), walk_west(row7), run_south(row8), run_north(row9), run_east(row10), run_west(row11)
- idle: 1 frame, 0.30s duration
- walk: 4 frames, 0.12s per frame
- run: 4 frames, 0.07s per frame
- All clips loop: true by default

Tile ID calculation: for row R, column C with 4 columns per row: tile_id = R*4 + C

Return ONLY the JSON array, no explanation or markdown.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// AIAssistPanel
// ---------------------------------------------------------------------------

const PRESETS = [
  'Walking animation for a knight, 4 frames south direction',
  'Running animation for a mage, 4 frames all 4 directions',
  'Idle breathing animation for a villager, single frame per direction',
  'Attack slash animation for a warrior, 3 frames, no loop',
  'Hurt/knockback animation, 2 frames, no loop',
  'All 12 standard clips: idle/walk/run × south/north/east/west',
];

export function AIAssistPanel() {
  const [prompt, setPrompt] = useState('');
  const [modelName, setModelName] = useState(import.meta.env.VITE_OLLAMA_MODEL || 'llama3');
  const [ollamaUrl, setOllamaUrl] = useState(import.meta.env.VITE_OLLAMA_URL || 'http://localhost:11434');
  const [status, setStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastJson, setLastJson] = useState<string | null>(null);
  const [previewClips, setPreviewClips] = useState<AnimClip[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { importClipsFromJson } = useAnimatorStore();

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (status.kind === 'generating') {
      abortRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'generating', message: 'Connecting to Ollama...' });
    setPreviewClips(null);

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

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const response = await client.generate(prompt, {
        system: SYSTEM_PROMPT,
        temperature: 0.7,
        maxTokens: 2048,
      });

      setStatus({ kind: 'generating', message: 'Parsing animation JSON...' });

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in model response.');
      }

      const raw = jsonMatch[0];
      setLastJson(raw);

      const parsed = JSON.parse(raw) as AnimClip[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Expected a non-empty JSON array of clips.');
      }

      // Validate & sanitize
      const sanitized = parsed.map((c) => ({
        id: c.id ?? Math.random().toString(36).slice(2),
        name: c.name ?? 'unnamed',
        loop: c.loop !== false,
        frames: Array.isArray(c.frames)
          ? c.frames.map((f: AnimFrame) => ({
              id: f.id ?? Math.random().toString(36).slice(2),
              tile_id: typeof f.tile_id === 'number' ? f.tile_id : 0,
              duration: typeof f.duration === 'number' && f.duration > 0 ? f.duration : 0.1,
            }))
          : [{ id: Math.random().toString(36).slice(2), tile_id: 0, duration: 0.1 }],
      }));

      setPreviewClips(sanitized);
      setStatus({
        kind: 'success',
        message: `Generated ${sanitized.length} clip(s). Preview below.`,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus({ kind: 'idle' });
      } else {
        setStatus({ kind: 'error', message: (err as Error).message });
      }
    } finally {
      abortRef.current = null;
    }
  }, [prompt, modelName, ollamaUrl, status]);

  const handleApply = useCallback(() => {
    if (!previewClips) return;
    importClipsFromJson(previewClips);
    setStatus({ kind: 'success', message: `Applied ${previewClips.length} clip(s) to editor.` });
    setPreviewClips(null);
  }, [previewClips, importClipsFromJson]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
    },
    [handleGenerate],
  );

  const statusColor: Record<GenerationStatus['kind'], string> = {
    idle: '#666',
    generating: '#90c0f0',
    success: '#70d870',
    error: '#e07070',
  };

  const isGenerating = status.kind === 'generating';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#131320',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '4px 8px',
          background: '#1a1a2a',
          borderBottom: '1px solid #2a2a3a',
          fontFamily: 'monospace',
          fontSize: 10,
          color: '#666',
          flexShrink: 0,
        }}
      >
        AI ASSIST
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {/* Prompt */}
        <FieldLabel>Animation Description</FieldLabel>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. walking animation for knight, 4 frames..."
          rows={4}
          style={textareaStyle}
        />
        <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', marginBottom: 8 }}>
          Ctrl+Enter to generate
        </div>

        {/* Presets */}
        <FieldLabel>Quick Presets</FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => setPrompt(p)}
              style={presetBtnStyle}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#445';
                (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
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

        {/* Model */}
        <FieldLabel>Model</FieldLabel>
        <input
          type="text"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          style={{ ...textInputStyle, marginBottom: 4 }}
        />
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 10 }}>
          {['llama3', 'mistral', 'codellama', 'gemma'].map((m) => (
            <button
              key={m}
              onClick={() => setModelName(m)}
              style={{
                background: modelName === m ? '#2a3a5a' : '#1a1a2a',
                border: modelName === m ? '1px solid #4a6aaa' : '1px solid #2a2a3a',
                borderRadius: 3,
                color: modelName === m ? '#90b0f0' : '#555',
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

        {/* Advanced */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          style={{
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
            marginBottom: 6,
          }}
        >
          <span>{showAdvanced ? '▼' : '▶'}</span> Advanced
        </button>
        {showAdvanced && (
          <div style={{ marginBottom: 10 }}>
            <FieldLabel>Ollama URL</FieldLabel>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              style={textInputStyle}
            />
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          style={{
            width: '100%',
            padding: '7px 0',
            background: isGenerating ? '#3a2a1a' : '#1e2a4a',
            border: isGenerating ? '1px solid #7a4a1a' : '1px solid #3a5a8a',
            borderRadius: 4,
            color: isGenerating ? '#e0a040' : '#90b8f8',
            fontFamily: 'monospace',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          {isGenerating ? 'Cancel' : 'Generate Animation'}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div
            style={{
              padding: '5px 8px',
              background: '#141420',
              border: `1px solid ${statusColor[status.kind]}44`,
              borderRadius: 3,
              fontFamily: 'monospace',
              fontSize: 10,
              color: statusColor[status.kind],
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            {status.message}
          </div>
        )}

        {/* Preview */}
        {previewClips && (
          <div style={{ marginBottom: 8 }}>
            <FieldLabel>Preview ({previewClips.length} clips)</FieldLabel>
            <div
              style={{
                background: '#141420',
                border: '1px solid #2a2a3a',
                borderRadius: 3,
                padding: 6,
                marginBottom: 6,
                maxHeight: 160,
                overflowY: 'auto',
              }}
            >
              {previewClips.map((c) => (
                <div
                  key={c.id}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 9,
                    color: '#7ab8f8',
                    marginBottom: 3,
                    lineHeight: 1.6,
                  }}
                >
                  <span style={{ color: '#c0d8ff' }}>{c.name}</span>
                  {' '}
                  <span style={{ color: '#555' }}>
                    {c.frames.length}fr &nbsp;
                    {c.frames.reduce((s, f) => s + f.duration, 0).toFixed(2)}s &nbsp;
                    {c.loop ? 'loop' : 'once'}
                  </span>
                  <div style={{ color: '#445', marginLeft: 8 }}>
                    {c.frames.map((f) => `t${f.tile_id}`).join(' ')}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleApply}
              style={{
                width: '100%',
                padding: '6px 0',
                background: '#1a3a1a',
                border: '1px solid #2a5a2a',
                borderRadius: 4,
                color: '#70d870',
                fontFamily: 'monospace',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              Apply to Editor
            </button>
          </div>
        )}

        {/* Raw JSON */}
        {lastJson && (
          <details style={{ marginBottom: 8 }}>
            <summary
              style={{ fontFamily: 'monospace', fontSize: 9, color: '#444', cursor: 'pointer' }}
            >
              Raw JSON ({lastJson.length} chars)
            </summary>
            <textarea
              readOnly
              value={lastJson}
              rows={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#0e0e1a',
                border: '1px solid #222',
                borderRadius: 3,
                color: '#555',
                fontFamily: 'monospace',
                fontSize: 9,
                padding: 4,
                resize: 'vertical',
                marginTop: 4,
              }}
            />
          </details>
        )}

        {/* Help */}
        <div
          style={{
            padding: '6px 8px',
            background: '#141420',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 9,
            color: '#444',
            lineHeight: 1.6,
          }}
        >
          Requires Ollama running locally.<br />
          Install: <span style={{ color: '#4a7ad0' }}>ollama.com</span><br />
          Pull model: <code>ollama pull llama3</code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'monospace',
        fontSize: 9,
        color: '#555',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 3,
      }}
    >
      {children}
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#1a1a2a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ddd',
  fontFamily: 'monospace',
  fontSize: 11,
  padding: '5px 8px',
  resize: 'vertical',
  outline: 'none',
  lineHeight: 1.5,
  marginBottom: 4,
};

const textInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#1a1a2a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ddd',
  fontFamily: 'monospace',
  fontSize: 11,
  padding: '4px 8px',
  outline: 'none',
};

const presetBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a2a3a',
  borderRadius: 3,
  color: '#777',
  fontFamily: 'monospace',
  fontSize: 9,
  padding: '3px 6px',
  cursor: 'pointer',
  textAlign: 'left',
  lineHeight: 1.4,
};
