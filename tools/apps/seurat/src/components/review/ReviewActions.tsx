import React from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';

interface Props {
  animName: string;
}

export function ReviewActions({ animName }: Props) {
  const manifest = useSeuratStore((s) => s.manifest);
  const approveAnimation = useSeuratStore((s) => s.approveAnimation);
  const rejectAnimation = useSeuratStore((s) => s.rejectAnimation);

  if (!manifest) return null;

  const anim = manifest.animations.find((a) => a.name === animName);
  if (!anim) return null;

  const total = anim.frames.length;
  const counts = {
    pending: anim.frames.filter((f) => f.status === 'pending').length,
    generated: anim.frames.filter((f) => f.status === 'generated').length,
    approved: anim.frames.filter((f) => f.status === 'approved').length,
    rejected: anim.frames.filter((f) => f.status === 'rejected').length,
  };
  const canApprove = counts.generated > 0 || counts.rejected > 0;
  const canReject = counts.generated > 0 || counts.approved > 0;

  return (
    <div style={styles.container}>
      <div style={styles.sectionTitle}>Review</div>

      <div style={styles.section}>
        <div style={styles.statusRow}>
          {counts.pending > 0 && <span style={{ color: '#666' }}>{counts.pending} pending</span>}
          {counts.generated > 0 && <span style={{ color: '#aa8800' }}>{counts.generated} generated</span>}
          {counts.approved > 0 && <span style={{ color: '#44aa44' }}>{counts.approved} approved</span>}
          {counts.rejected > 0 && <span style={{ color: '#aa4444' }}>{counts.rejected} rejected</span>}
          <span style={{ color: '#555' }}>{total} total</span>
        </div>

        <div style={styles.actions}>
          <button
            onClick={() => approveAnimation(animName)}
            disabled={!canApprove}
            style={{ ...styles.approveBtn, opacity: canApprove ? 1 : 0.4 }}
          >
            Approve Animation
          </button>
          <button
            onClick={() => rejectAnimation(animName)}
            disabled={!canReject}
            style={{ ...styles.rejectBtn, opacity: canReject ? 1 : 0.4 }}
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#aaa',
    fontWeight: 600,
  },
  section: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  statusRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    fontFamily: 'monospace',
    fontSize: 9,
  },
  actions: {
    display: 'flex',
    gap: 6,
  },
  approveBtn: {
    flex: 1,
    background: '#1e3a2e',
    border: '1px solid #44aa44',
    borderRadius: 4,
    color: '#70d870',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  rejectBtn: {
    background: '#3a1e1e',
    border: '1px solid #aa4444',
    borderRadius: 4,
    color: '#d87070',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
};
