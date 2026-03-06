import { useState } from 'react';
import type {
  CharacterManifest,
  CharacterFrame,
  FrameStatus,
} from '@vulkan-game-tools/asset-types';

const BRIDGE_URL = 'http://localhost:9101';

interface ReviewPanelProps {
  manifest: CharacterManifest;
  onManifestUpdate: (manifest: CharacterManifest) => void;
  onFrameSelect: (animName: string, frameIndex: number) => void;
  onRegenerateFrame: (animName: string, frameIndex: number) => void;
}

const STATUS_COLORS: Record<FrameStatus, string> = {
  pending: '#666',
  generating: '#cc8800',
  generated: '#aa8800',
  approved: '#44aa44',
  rejected: '#aa4444',
};

const STATUS_LABELS: Record<FrameStatus, string> = {
  pending: 'P',
  generating: '...',
  generated: 'G',
  approved: 'OK',
  rejected: 'X',
};

export function ReviewPanel({
  manifest,
  onManifestUpdate,
  onFrameSelect,
  onRegenerateFrame,
}: ReviewPanelProps) {
  const [filter, setFilter] = useState<FrameStatus | 'all'>('all');
  const [batchAction, setBatchAction] = useState<FrameStatus>('approved');

  const updateFrameStatus = async (
    animName: string,
    frameIndex: number,
    status: FrameStatus,
    notes?: string,
  ) => {
    try {
      const res = await fetch(
        `${BRIDGE_URL}/api/characters/${manifest.character_id}/frames/${animName}/${frameIndex}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, notes }),
        },
      );
      if (!res.ok) return;

      // Update local state
      const updated = structuredClone(manifest);
      const anim = updated.animations.find((a) => a.name === animName);
      const frame = anim?.frames.find((f) => f.index === frameIndex);
      if (frame) {
        frame.status = status;
        if (notes !== undefined) {
          if (!frame.review) frame.review = { reviewer: 'human', notes };
          else frame.review.notes = notes;
        }
      }
      onManifestUpdate(updated);
    } catch (err) {
      console.error('Failed to update frame status:', err);
    }
  };

  const handleBatchApply = async () => {
    const updated = structuredClone(manifest);
    for (const anim of updated.animations) {
      for (const frame of anim.frames) {
        if (frame.status === 'generated') {
          frame.status = batchAction;
          try {
            await fetch(
              `${BRIDGE_URL}/api/characters/${manifest.character_id}/frames/${anim.name}/${frame.index}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: batchAction }),
              },
            );
          } catch {
            // continue
          }
        }
      }
    }
    onManifestUpdate(updated);
  };

  const handleAssemble = async () => {
    try {
      const res = await fetch(
        `${BRIDGE_URL}/api/characters/${manifest.character_id}/assemble`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      const result = await res.json();
      if (result.errors?.length) {
        alert(`Assembly completed with errors:\n${result.errors.join('\n')}`);
      } else {
        alert(`Assembly complete! ${result.approvedFrames}/${result.totalFrames} approved frames.`);
      }
    } catch (err) {
      alert(`Assembly failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const filteredAnims = manifest.animations.map((anim) => ({
    ...anim,
    frames: anim.frames.filter((f) => filter === 'all' || f.status === filter),
  }));

  return (
    <div style={{ padding: 8, overflowY: 'auto', maxHeight: 500 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>Review</strong>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FrameStatus | 'all')}
          style={{ fontSize: 11, background: '#222', color: '#eee', border: '1px solid #444' }}
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="generated">Generated</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Batch operations */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', fontSize: 11 }}>
        <span>Batch:</span>
        <select
          value={batchAction}
          onChange={(e) => setBatchAction(e.target.value as FrameStatus)}
          style={{ fontSize: 11, background: '#222', color: '#eee', border: '1px solid #444' }}
        >
          <option value="approved">Approve all generated</option>
          <option value="rejected">Reject all generated</option>
        </select>
        <button onClick={handleBatchApply} style={{ fontSize: 11, padding: '2px 6px' }}>
          Apply
        </button>
        <button
          onClick={handleAssemble}
          style={{ fontSize: 11, padding: '2px 6px', marginLeft: 'auto', background: '#353' }}
        >
          Assemble Atlas
        </button>
      </div>

      {/* Animation grid */}
      {filteredAnims.map((anim) => {
        if (anim.frames.length === 0) return null;
        return (
          <div key={anim.name} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>{anim.name}</div>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {anim.frames.map((frame) => (
                <FrameCell
                  key={frame.index}
                  frame={frame}
                  animName={anim.name}
                  onClick={() => onFrameSelect(anim.name, frame.index)}
                  onApprove={() => updateFrameStatus(anim.name, frame.index, 'approved')}
                  onReject={() => updateFrameStatus(anim.name, frame.index, 'rejected')}
                  onRegenerate={() => onRegenerateFrame(anim.name, frame.index)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface FrameCellProps {
  frame: CharacterFrame;
  animName: string;
  onClick: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRegenerate: () => void;
}

function FrameCell({ frame, onClick, onApprove, onReject, onRegenerate }: FrameCellProps) {
  return (
    <div
      style={{
        width: 48,
        border: `2px solid ${STATUS_COLORS[frame.status]}`,
        borderRadius: 4,
        background: '#1a1a1a',
        cursor: 'pointer',
        position: 'relative',
      }}
      onClick={onClick}
    >
      {/* Status badge */}
      <div
        style={{
          position: 'absolute',
          top: 1,
          right: 1,
          fontSize: 8,
          background: STATUS_COLORS[frame.status],
          color: '#fff',
          padding: '0 3px',
          borderRadius: 2,
        }}
      >
        {STATUS_LABELS[frame.status]}
      </div>

      {/* Frame index */}
      <div style={{ textAlign: 'center', fontSize: 11, padding: '10px 0 4px' }}>f{frame.index}</div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 1, padding: 2, justifyContent: 'center' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          style={{ fontSize: 9, padding: '1px 3px', background: '#353', border: 'none', color: '#8d8', cursor: 'pointer' }}
          title="Approve"
        >
          OK
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onReject(); }}
          style={{ fontSize: 9, padding: '1px 3px', background: '#533', border: 'none', color: '#d88', cursor: 'pointer' }}
          title="Reject"
        >
          X
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
          style={{ fontSize: 9, padding: '1px 3px', background: '#335', border: 'none', color: '#88d', cursor: 'pointer' }}
          title="Regenerate"
        >
          Re
        </button>
      </div>
    </div>
  );
}
