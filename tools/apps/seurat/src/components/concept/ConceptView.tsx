import React, { useState, useEffect } from 'react';
import type { ConceptArt } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';

export function ConceptView() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);

  const [description, setDescription] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!manifest) return;
    setDescription(manifest.concept.description);
    setStylePrompt(manifest.concept.style_prompt);
    setNegativePrompt(manifest.concept.negative_prompt);
  }, [manifest?.character_id]);

  if (!manifest) return <EmptyState />;

  const handleSave = async (approved?: boolean) => {
    setSaving(true);
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
      approved: approved ?? manifest.concept.approved,
    };
    await saveConcept(concept);
    setSaving(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Concept Art</span>
        {manifest.concept.approved && (
          <span style={styles.approvedBadge}>Approved</span>
        )}
      </div>

      <div style={styles.form}>
        <label style={styles.label}>Character Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          style={styles.textarea}
          placeholder="Describe the character: appearance, gear, personality..."
        />

        <label style={styles.label}>Style Prompt (prepended to all AI generation)</label>
        <textarea
          value={stylePrompt}
          onChange={(e) => setStylePrompt(e.target.value)}
          rows={3}
          style={styles.textarea}
          placeholder="pixel art, 128x128, medieval fantasy, low-res..."
        />

        <label style={styles.label}>Negative Prompt</label>
        <textarea
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          rows={2}
          style={styles.textarea}
          placeholder="blurry, realistic, 3d render..."
        />

        <div style={styles.actions}>
          <button onClick={() => handleSave()} disabled={saving} style={styles.saveBtn}>
            {saving ? 'Saving...' : 'Save Concept'}
          </button>
          {!manifest.concept.approved && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              style={styles.approveBtn}
            >
              Approve Concept
            </button>
          )}
        </div>

        {manifest.concept.reference_images.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <label style={styles.label}>Reference Images</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {manifest.concept.reference_images.map((img, i) => (
                <div
                  key={i}
                  style={{
                    width: 80,
                    height: 80,
                    background: '#222',
                    borderRadius: 4,
                    border: '1px solid #444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    color: '#555',
                    fontFamily: 'monospace',
                  }}
                >
                  {img}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: '#555', fontFamily: 'monospace', fontSize: 12 }}>
      Select a character from the Dashboard to edit its concept.
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    maxWidth: 640,
    height: '100%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 700,
    color: '#ccc',
  },
  approvedBadge: {
    fontSize: 10,
    color: '#44aa44',
    border: '1px solid #44aa44',
    padding: '2px 8px',
    borderRadius: 3,
    fontFamily: 'monospace',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#888',
    marginTop: 8,
  },
  textarea: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5a',
    borderRadius: 4,
    color: '#ddd',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: '8px 10px',
    resize: 'vertical' as const,
    outline: 'none',
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 12,
  },
  saveBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 20px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  approveBtn: {
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 20px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
