import React, { useEffect, useState } from 'react';
import type { CharacterManifest } from '@vulkan-game-tools/asset-types';
import { getManifestStats } from '@vulkan-game-tools/asset-types';
import * as api from '../../lib/bridge-api.js';

interface Props {
  characterId: string;
  selected: boolean;
  onSelect: () => void;
}

export function CharacterCard({ characterId, selected, onSelect }: Props) {
  const [manifest, setManifest] = useState<CharacterManifest | null>(null);

  useEffect(() => {
    api.fetchManifest(characterId).then(setManifest).catch(() => {});
  }, [characterId]);

  const stats = manifest ? getManifestStats(manifest) : null;
  const progress = stats && stats.total > 0 ? stats.approved / stats.total : 0;

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 16px',
        background: selected ? '#1e2a42' : '#161624',
        border: selected ? '1px solid #4a8af8' : '1px solid #2a2a3a',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#ccc', fontWeight: 600 }}>
          {manifest?.display_name ?? characterId}
        </span>
        <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#555' }}>
          {characterId}
        </span>
      </div>

      {stats && (
        <>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'monospace', color: '#888' }}>
            <span>{stats.total} frames</span>
            <span style={{ color: '#44aa44' }}>{stats.approved} ok</span>
            <span style={{ color: '#aa8800' }}>{stats.pending} pending</span>
            {stats.rejected > 0 && <span style={{ color: '#aa4444' }}>{stats.rejected} rej</span>}
          </div>
          <div style={{ height: 4, background: '#2a2a3a', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                background: progress === 1 ? '#44aa44' : '#4a8af8',
                borderRadius: 2,
                transition: 'width 0.3s',
              }}
            />
          </div>
        </>
      )}

      {manifest?.concept.approved && (
        <span style={{ fontSize: 9, color: '#4a4', fontFamily: 'monospace' }}>
          Concept approved
        </span>
      )}
    </div>
  );
}
