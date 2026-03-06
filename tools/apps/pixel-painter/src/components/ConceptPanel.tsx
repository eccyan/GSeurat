import { useState } from 'react';
import type { CharacterManifest, ConceptArt } from '@vulkan-game-tools/asset-types';

const BRIDGE_URL = 'http://localhost:9101';

interface ConceptPanelProps {
  manifest: CharacterManifest;
  onManifestUpdate: (manifest: CharacterManifest) => void;
}

export function ConceptPanel({ manifest, onManifestUpdate }: ConceptPanelProps) {
  const [description, setDescription] = useState(manifest.concept.description);
  const [stylePrompt, setStylePrompt] = useState(manifest.concept.style_prompt);
  const [negativePrompt, setNegativePrompt] = useState(manifest.concept.negative_prompt);
  const [saving, setSaving] = useState(false);

  const save = async (concept: ConceptArt) => {
    setSaving(true);
    try {
      const updated = { ...manifest, concept };
      const res = await fetch(`${BRIDGE_URL}/api/characters/${manifest.character_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated, null, 2),
      });
      if (res.ok) {
        onManifestUpdate(updated);
      }
    } catch (err) {
      console.error('Failed to save concept:', err);
    }
    setSaving(false);
  };

  const handleSave = () => {
    save({
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    });
  };

  const handleApprove = () => {
    save({ ...manifest.concept, description, style_prompt: stylePrompt, negative_prompt: negativePrompt, approved: true });
  };

  const labelStyle = { fontSize: 11, color: '#aaa', marginBottom: 2, display: 'block' as const };
  const inputStyle = {
    width: '100%',
    fontSize: 12,
    background: '#222',
    color: '#eee',
    border: '1px solid #444',
    borderRadius: 3,
    padding: '4px 6px',
    boxSizing: 'border-box' as const,
    marginBottom: 6,
  };

  return (
    <div style={{ padding: 8, borderBottom: '1px solid #444' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Concept Art</strong>
        {manifest.concept.approved && (
          <span style={{ fontSize: 10, color: '#4a4', border: '1px solid #4a4', padding: '0 4px', borderRadius: 3 }}>
            Approved
          </span>
        )}
      </div>

      <label style={labelStyle}>Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
        placeholder="Town guard in plate armor with halberd..."
      />

      <label style={labelStyle}>Style Prompt (prepended to all AI generation)</label>
      <textarea
        value={stylePrompt}
        onChange={(e) => setStylePrompt(e.target.value)}
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
        placeholder="pixel art, 128x128, medieval fantasy..."
      />

      <label style={labelStyle}>Negative Prompt</label>
      <textarea
        value={negativePrompt}
        onChange={(e) => setNegativePrompt(e.target.value)}
        rows={1}
        style={{ ...inputStyle, resize: 'vertical' }}
        placeholder="blurry, realistic, 3d render"
      />

      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ fontSize: 11, padding: '3px 8px' }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {!manifest.concept.approved && (
          <button
            onClick={handleApprove}
            disabled={saving}
            style={{ fontSize: 11, padding: '3px 8px', background: '#353', color: '#8d8' }}
          >
            Approve Concept
          </button>
        )}
      </div>
    </div>
  );
}
