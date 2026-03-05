import React, { useState, useCallback, useRef } from 'react';
import { OllamaClient } from '@vulkan-game-tools/ai-providers';
import { useEditorStore } from '../store/useEditorStore.js';

// ---------------------------------------------------------------------------
// System prompt for scene generation
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a level designer for an HD-2D Vulkan game engine.
Generate a tile-based scene as a JSON object when given a natural language description.

The JSON must strictly follow this schema:
{
  "width": <integer 8-32>,
  "height": <integer 8-32>,
  "tiles": [<array of integers, one per tile, row-major order>],
  "solid_tiles": [<array of tile indices that are solid/collidable>],
  "ambient_color": [<r>, <g>, <b>, <a>],
  "lights": [
    { "position": [<x>, <z>], "radius": <number>, "color": [<r>, <g>, <b>], "intensity": <number>, "height": <number> }
  ],
  "npcs": [
    {
      "name": "<string>",
      "position": [<x>, 0, <z>],
      "tint": [<r>, <g>, <b>, 1.0],
      "facing": "<north|south|east|west>",
      "patrol_speed": <number>,
      "patrol_interval": <number>,
      "dialog": [],
      "light_color": [<r>, <g>, <b>, 1.0],
      "light_radius": <number>,
      "waypoints": []
    }
  ]
}

Tile IDs:
0 = beige floor
1 = dark wall (solid)
2 = water (blue, animated)
5 = lava (red, solid)
8 = torch wall (solid)
0xFFFF (65535) = transparent/empty

Rules:
- Perimeter tiles should usually be walls (id=1, solid).
- Keep the scene interesting and playable.
- Lights should be placed near torches or points of interest.
- NPCs should be on walkable floor tiles.
- Return ONLY the JSON object, no explanation or markdown.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type GenerationStatus =
  | { kind: 'idle' }
  | { kind: 'generating'; message: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// AIPanel
// ---------------------------------------------------------------------------
export function AIPanel() {
  const [prompt, setPrompt] = useState('');
  const [modelName, setModelName] = useState('llama3');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [status, setStatus] = useState<GenerationStatus>({ kind: 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastJson, setLastJson] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { setTiles, setAmbientColor, addLight, addNpc, setDirty } = useEditorStore();

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (status.kind === 'generating') {
      // Cancel in-flight
      abortRef.current?.abort();
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'generating', message: 'Connecting to Ollama…' });

    const client = new OllamaClient(ollamaUrl, modelName);

    // Check availability first
    const available = await client.isAvailable().catch(() => false);
    if (!available) {
      setStatus({
        kind: 'error',
        message: `Cannot reach Ollama at ${ollamaUrl}. Is it running?`,
      });
      return;
    }

    setStatus({ kind: 'generating', message: `Generating with ${modelName}…` });

    try {
      const response = await client.generate(prompt, {
        system: SYSTEM_PROMPT,
        temperature: 0.7,
        maxTokens: 2048,
      });

      setStatus({ kind: 'generating', message: 'Parsing scene JSON…' });

      // Extract JSON from response (may have markdown fences)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in model response.');
      }

      const raw = jsonMatch[0];
      setLastJson(raw);

      const json = JSON.parse(raw) as Record<string, unknown>;

      // Apply to store
      applyGeneratedScene(json, { setTiles, setAmbientColor, addLight, addNpc, setDirty });

      setStatus({ kind: 'success', message: `Scene generated (${modelName}).` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: msg });
    }
  }, [prompt, modelName, ollamaUrl, status, setTiles, setAmbientColor, addLight, addNpc, setDirty]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  const handleApplyLastJson = useCallback(() => {
    if (!lastJson) return;
    try {
      const json = JSON.parse(lastJson) as Record<string, unknown>;
      applyGeneratedScene(json, { setTiles, setAmbientColor, addLight, addNpc, setDirty });
      setStatus({ kind: 'success', message: 'Re-applied last JSON.' });
    } catch (e) {
      setStatus({ kind: 'error', message: `Re-apply failed: ${e}` });
    }
  }, [lastJson, setTiles, setAmbientColor, addLight, addNpc, setDirty]);

  const statusColor: Record<GenerationStatus['kind'], string> = {
    idle: '#666',
    generating: '#90c0f0',
    success: '#70d870',
    error: '#e07070',
  };

  const isGenerating = status.kind === 'generating';

  // Preset prompts for quick inspiration
  const PRESETS = [
    'A small dungeon room with a fountain in the center',
    'A forest clearing with lava cracks and 2 patrol guards',
    'A castle throne room with torches lining the walls',
    'A narrow cave corridor with water pools and hidden treasure',
  ];

  return (
    <div style={{
      width: 260,
      background: '#222',
      borderLeft: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        background: '#1e1e1e',
        borderBottom: '1px solid #333',
        fontFamily: 'monospace',
        fontSize: 11,
        color: '#aaa',
        fontWeight: 600,
        letterSpacing: '0.04em',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 14 }}>✨</span>
        AI Generation
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {/* Prompt textarea */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#777',
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Level Description
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the level you want to generate…"
            rows={4}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1a1a1a',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#ddd',
              fontFamily: 'monospace',
              fontSize: 11,
              padding: '6px 8px',
              resize: 'vertical',
              outline: 'none',
              lineHeight: 1.5,
            }}
          />
          <div style={{
            fontFamily: 'monospace',
            fontSize: 9,
            color: '#555',
            marginTop: 2,
          }}>
            Ctrl+Enter to generate
          </div>
        </div>

        {/* Preset prompts */}
        <div style={{ marginBottom: 10 }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#666',
            marginBottom: 4,
          }}>
            Quick Presets
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {PRESETS.map((preset, i) => (
              <button
                key={i}
                onClick={() => setPrompt(preset)}
                style={{
                  background: 'transparent',
                  border: '1px solid #333',
                  borderRadius: 3,
                  color: '#888',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  lineHeight: 1.4,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#555';
                  (e.currentTarget as HTMLButtonElement).style.color = '#bbb';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
                  (e.currentTarget as HTMLButtonElement).style.color = '#888';
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Model selector */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#777',
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            Model
          </div>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="llama3"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: '#1a1a1a',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#ddd',
              fontFamily: 'monospace',
              fontSize: 11,
              padding: '5px 8px',
              outline: 'none',
            }}
          />
          <div style={{
            display: 'flex',
            gap: 4,
            marginTop: 4,
            flexWrap: 'wrap',
          }}>
            {['llama3', 'mistral', 'codellama', 'gemma'].map((m) => (
              <button
                key={m}
                onClick={() => setModelName(m)}
                style={{
                  background: modelName === m ? '#2a3a5a' : '#1a1a1a',
                  border: modelName === m ? '1px solid #4a6aaa' : '1px solid #333',
                  borderRadius: 3,
                  color: modelName === m ? '#90b0f0' : '#666',
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
        <div style={{ marginBottom: 10 }}>
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontFamily: 'monospace',
              fontSize: 10,
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{showAdvanced ? '▼' : '▶'}</span>
            Advanced
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 6 }}>
              <div style={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#666',
                marginBottom: 3,
              }}>
                Ollama URL
              </div>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 3,
                  color: '#aaa',
                  fontFamily: 'monospace',
                  fontSize: 10,
                  padding: '4px 7px',
                  outline: 'none',
                }}
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
            background: isGenerating ? '#3a2a1a' : '#2a3a6a',
            border: isGenerating ? '1px solid #7a4a1a' : '1px solid #4a6ab8',
            borderRadius: 5,
            color: isGenerating ? '#e0a040' : '#90b8f8',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            marginBottom: 8,
          }}
        >
          {isGenerating ? (
            <>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
              Cancel
            </>
          ) : (
            <>
              <span>✨</span>
              Generate Level
            </>
          )}
        </button>

        {/* Status */}
        {status.kind !== 'idle' && (
          <div style={{
            padding: '6px 8px',
            background: '#1a1a1a',
            border: `1px solid ${statusColor[status.kind]}44`,
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 10,
            color: statusColor[status.kind],
            lineHeight: 1.5,
            marginBottom: 8,
          }}>
            {status.kind === 'generating' && (
              <span style={{ marginRight: 4 }}>⟳</span>
            )}
            {status.kind === 'success' && (
              <span style={{ marginRight: 4 }}>✓</span>
            )}
            {status.kind === 'error' && (
              <span style={{ marginRight: 4 }}>✗</span>
            )}
            {status.message}
          </div>
        )}

        {/* Re-apply last JSON */}
        {lastJson && status.kind !== 'generating' && (
          <button
            onClick={handleApplyLastJson}
            style={{
              width: '100%',
              padding: '5px 0',
              background: 'transparent',
              border: '1px solid #333',
              borderRadius: 4,
              color: '#777',
              fontFamily: 'monospace',
              fontSize: 10,
              cursor: 'pointer',
              marginBottom: 8,
            }}
          >
            Re-apply Last Result
          </button>
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
                width: '100%',
                boxSizing: 'border-box',
                background: '#141414',
                border: '1px solid #333',
                borderRadius: 3,
                color: '#666',
                fontFamily: 'monospace',
                fontSize: 9,
                padding: '4px',
                resize: 'vertical',
                marginTop: 4,
              }}
            />
          </details>
        )}

        {/* Help text */}
        <div style={{
          padding: '6px 8px',
          background: '#1a1a1a',
          borderRadius: 4,
          fontFamily: 'monospace',
          fontSize: 9,
          color: '#555',
          lineHeight: 1.6,
        }}>
          Requires Ollama running locally.<br />
          Install: <span style={{ color: '#4a7ad0' }}>ollama.com</span><br />
          Pull model: <code>ollama pull llama3</code>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apply generated scene JSON to the editor store
// ---------------------------------------------------------------------------
interface ApplyDeps {
  setTiles: (tiles: { id: number; solid: boolean }[], w: number, h: number) => void;
  setAmbientColor: (c: [number, number, number, number]) => void;
  addLight: (l: {
    position: [number, number];
    radius: number;
    color: [number, number, number];
    intensity: number;
    height: number;
  }) => void;
  addNpc: (n: {
    name: string;
    position: [number, number, number];
    tint: [number, number, number, number];
    facing: string;
    patrol_speed: number;
    patrol_interval: number;
    dialog: { speaker_key: string; text_key: string }[];
    light_color: [number, number, number, number];
    light_radius: number;
    waypoints: [number, number][];
  }) => void;
  setDirty: (d: boolean) => void;
}

function applyGeneratedScene(
  json: Record<string, unknown>,
  deps: ApplyDeps,
): void {
  const { setTiles, setAmbientColor, addLight, addNpc, setDirty } = deps;

  const w = (json.width as number) ?? 16;
  const h = (json.height as number) ?? 16;
  const tileIds = (json.tiles as number[]) ?? Array(w * h).fill(0);
  const solidSet = new Set<number>((json.solid_tiles as number[]) ?? []);

  const tileData = tileIds.slice(0, w * h).map((id: number, i: number) => ({
    id: id ?? 0,
    solid: solidSet.has(i),
  }));

  setTiles(tileData, w, h);

  const ambient = json.ambient_color as [number, number, number, number] | undefined;
  if (Array.isArray(ambient) && ambient.length >= 3) {
    setAmbientColor([
      ambient[0] ?? 0.25,
      ambient[1] ?? 0.28,
      ambient[2] ?? 0.45,
      ambient[3] ?? 1.0,
    ]);
  }

  const lights = (json.lights as Record<string, unknown>[] | undefined) ?? [];
  for (const l of lights) {
    const pos = (l.position as [number, number]) ?? [0, 0];
    addLight({
      position: [pos[0] ?? 0, pos[1] ?? 0],
      radius: (l.radius as number) ?? 4,
      color: (l.color as [number, number, number]) ?? [1, 0.8, 0.4],
      intensity: (l.intensity as number) ?? 1,
      height: (l.height as number) ?? 3,
    });
  }

  const npcs = (json.npcs as Record<string, unknown>[] | undefined) ?? [];
  for (const n of npcs) {
    const pos = (n.position as [number, number, number]) ?? [0, 0, 0];
    addNpc({
      name: (n.name as string) ?? 'npc',
      position: [pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0],
      tint: (n.tint as [number, number, number, number]) ?? [1, 1, 1, 1],
      facing: (n.facing as string) ?? 'south',
      patrol_speed: (n.patrol_speed as number) ?? 2,
      patrol_interval: (n.patrol_interval as number) ?? 2,
      dialog: (n.dialog as { speaker_key: string; text_key: string }[]) ?? [],
      light_color: (n.light_color as [number, number, number, number]) ?? [1, 0.8, 0.6, 1],
      light_radius: (n.light_radius as number) ?? 3,
      waypoints: (n.waypoints as [number, number][]) ?? [],
    });
  }

  setDirty(true);
}
