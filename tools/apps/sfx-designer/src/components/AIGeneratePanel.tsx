import React, { useState, useCallback } from 'react';
import { useSfxStore } from '../store/useSfxStore.js';
import { SFX_PRESETS } from '../audio/presets.js';
import { renderSfx, SAMPLE_RATE } from '../audio/synth.js';
import { smartGenerate, SmartGenerateResult } from '../audio/smart-generate.js';

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
  const [lastResult, setLastResult] = useState<SmartGenerateResult | null>(null);

  // Load a named preset into the editor store
  const loadPreset = useCallback(
    (presetName: string) => {
      const preset = SFX_PRESETS.find((p) => p.name === presetName);
      if (!preset) return;

      const makeId = () => Math.random().toString(36).slice(2, 9);

      const oscillators = preset.oscillators.map((o) => ({ ...o, id: makeId() }));
      const filters = preset.filters.map((f) => ({ ...f, id: makeId() }));

      useSfxStore.setState({
        oscillators,
        filters,
        envelope: { ...preset.envelope },
        reverb: { ...preset.reverb },
        delay: { ...preset.delay },
        distortion: { ...preset.distortion },
      });

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

  // Smart generate from prompt
  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;

    const result = smartGenerate(prompt.trim());
    setLastResult(result);

    const makeId = () => Math.random().toString(36).slice(2, 9);

    const oscillators = result.preset.oscillators.map((o) => ({ ...o, id: makeId() }));
    const filters = result.preset.filters.map((f) => ({ ...f, id: makeId() }));

    useSfxStore.setState({
      oscillators,
      filters,
      envelope: { ...result.preset.envelope },
      reverb: { ...result.preset.reverb },
      delay: { ...result.preset.delay },
      distortion: { ...result.preset.distortion },
    });

    const samples = renderSfx({
      oscillators,
      envelope: result.preset.envelope,
      filters,
      reverb: result.preset.reverb,
      delay: result.preset.delay,
      distortion: result.preset.distortion,
    });
    store.setGeneratedSamples(samples);
  }, [prompt, store]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate],
  );

  // Quick-fill chips
  const QUICK_CHIPS = [
    'explosion',
    'laser beam',
    'coin pickup',
    'magic spell',
    'sword slash',
    'water splash',
  ];

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>PROCEDURAL GENERATION</span>
      </div>

      <div style={styles.body}>
        {/* ---------------------------------------------------------------- */}
        {/* Smart Generate                                                   */}
        {/* ---------------------------------------------------------------- */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>SMART GENERATE</div>

          {/* Prompt */}
          <div style={styles.fieldGroup}>
            <div style={styles.fieldLabel}>Describe the sound</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. deep explosion with echo, bright laser zap, coin pickup..."
              rows={3}
              style={styles.textarea}
            />
            <div style={styles.hint}>Ctrl+Enter to generate</div>
          </div>

          {/* Quick chips */}
          <div style={styles.exampleRow}>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => { setPrompt(chip); }}
                style={styles.exampleBtn}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            style={{
              ...styles.generateBtn,
              opacity: !prompt.trim() ? 0.6 : 1,
            }}
          >
            Generate
          </button>

          {/* Matched keywords */}
          {lastResult && (
            <div style={styles.statusBox}>
              {lastResult.matchedKeywords.length > 0 ? (
                <>
                  <span style={{ color: '#70d870' }}>Matched: </span>
                  {lastResult.matchedKeywords.join(', ')}
                  {lastResult.matchedModifiers.length > 0 && (
                    <>
                      <br />
                      <span style={{ color: '#90b8e0' }}>Modifiers: </span>
                      {lastResult.matchedModifiers.join(', ')}
                    </>
                  )}
                </>
              ) : (
                <span style={{ color: '#e0b070' }}>No keyword match — using generic sound</span>
              )}
            </div>
          )}
        </div>

        <div style={styles.divider} />

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

        {/* Help */}
        <div style={styles.helpBox}>
          <div style={styles.helpTitle}>How it works</div>
          <div style={styles.helpText}>
            Generates SFX from text description using keyword matching.<br />
            No server required — runs entirely in the browser.
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
  generateBtn: {
    width: '100%',
    padding: '8px 0',
    borderRadius: 5,
    border: '1px solid #6a4ae0',
    background: '#2a1a5a',
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
    border: '1px solid #2a2a4a44',
    borderRadius: 4,
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#8080a0',
    lineHeight: 1.5,
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
