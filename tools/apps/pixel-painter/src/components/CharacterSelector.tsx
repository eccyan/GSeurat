import { useEffect, useState } from 'react';
import type { CharacterManifest, ManifestStats } from '@vulkan-game-tools/asset-types';
import { getManifestStats } from '@vulkan-game-tools/asset-types';

const BRIDGE_URL = 'http://localhost:9101';

interface CharacterSelectorProps {
  onSelect: (id: string, manifest: CharacterManifest) => void;
  selectedId: string | null;
}

export function CharacterSelector({ onSelect, selectedId }: CharacterSelectorProps) {
  const [characters, setCharacters] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, ManifestStats>>({});
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BRIDGE_URL}/api/characters`);
      const data = await res.json();
      const ids = (data.characters ?? []) as string[];
      setCharacters(ids);

      // Fetch stats for each character
      const newStats: Record<string, ManifestStats> = {};
      for (const id of ids) {
        try {
          const mRes = await fetch(`${BRIDGE_URL}/api/characters/${id}`);
          const manifest = (await mRes.json()) as CharacterManifest;
          newStats[id] = getManifestStats(manifest);
        } catch {
          // skip
        }
      }
      setStats(newStats);
    } catch {
      // Bridge not running
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSelect = async (id: string) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/api/characters/${id}`);
      const manifest = (await res.json()) as CharacterManifest;
      onSelect(id, manifest);
    } catch (err) {
      console.error('Failed to load character:', err);
    }
  };

  return (
    <div style={{ padding: 8, borderBottom: '1px solid #444' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>Character</strong>
        <button onClick={refresh} disabled={loading} style={{ fontSize: 11, padding: '2px 6px' }}>
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      {characters.length === 0 ? (
        <div style={{ color: '#888', fontSize: 12 }}>No characters found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {characters.map((id) => {
            const s = stats[id];
            const isSelected = id === selectedId;
            return (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                style={{
                  textAlign: 'left',
                  padding: '4px 8px',
                  background: isSelected ? '#335' : '#222',
                  border: isSelected ? '1px solid #66a' : '1px solid #444',
                  borderRadius: 4,
                  color: '#eee',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 13 }}>{id}</div>
                {s && (
                  <div style={{ fontSize: 11, display: 'flex', gap: 8, marginTop: 2 }}>
                    <ProgressBar stats={s} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ stats }: { stats: ManifestStats }) {
  if (stats.total === 0) return null;
  const pct = (n: number) => `${((n / stats.total) * 100).toFixed(0)}%`;
  const approvedPct = stats.approved / stats.total;

  return (
    <div style={{ flex: 1 }}>
      <div
        style={{
          height: 6,
          background: '#333',
          borderRadius: 3,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            width: pct(stats.approved),
            background: '#4a4',
            position: 'absolute',
            left: 0,
          }}
        />
        <div
          style={{
            height: '100%',
            width: pct(stats.generated),
            background: '#aa4',
            position: 'absolute',
            left: pct(stats.approved),
          }}
        />
        <div
          style={{
            height: '100%',
            width: pct(stats.rejected),
            background: '#a44',
            position: 'absolute',
            left: pct(stats.approved + stats.generated),
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
        {stats.approved}/{stats.total} approved ({(approvedPct * 100).toFixed(0)}%)
      </div>
    </div>
  );
}
