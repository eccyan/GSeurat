import React, { useState } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ManifestJsonEditor } from '../manifest/ManifestJsonEditor.js';
import { ConceptActions } from '../concept/ConceptActions.js';
// ChibiActions is now integrated into ConceptActions step 5
import { AtlasActions } from '../atlas/AtlasActions.js';
import { GenerateActions } from '../generate/GenerateActions.js';
import { PipelineControls } from '../generate/PipelineControls.js';
import { ReviewActions } from '../review/ReviewActions.js';

function Collapsible({ title, defaultOpen = true, badge, children }: {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={styles.collapsible}>
      <button onClick={() => setOpen(!open)} style={styles.collapseHeader}>
        <span style={styles.collapseArrow}>{open ? '▾' : '▸'}</span>
        <span style={styles.collapseTitle}>{title}</span>
        {badge && <span style={styles.collapseBadge}>{badge}</span>}
      </button>
      {open && <div style={styles.collapseBody}>{children}</div>}
    </div>
  );
}

export function RightPane() {
  const treeSelection = useSeuratStore((s) => s.treeSelection);

  return (
    <div style={styles.paneOuter}>
      <div className="right-pane" style={styles.paneInner}>
        <RightContent selection={treeSelection} />
      </div>
      <style>{`
        .right-pane::-webkit-scrollbar { width: 6px; }
        .right-pane::-webkit-scrollbar-track { background: #111120; }
        .right-pane::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 3px; }
        .right-pane::-webkit-scrollbar-thumb:hover { background: #5a5a7a; }
      `}</style>
    </div>
  );
}

function RightContent({ selection }: { selection: ReturnType<typeof useSeuratStore.getState>['treeSelection'] }) {
  switch (selection.kind) {
    case 'manifest':
      return <ManifestJsonEditor />;
    case 'character':
      return <CharacterSections />;
    case 'animation':
      return (
        <>
          <Collapsible title="Pipeline" defaultOpen>
            <PipelineControls animName={selection.animName} />
          </Collapsible>
          <Collapsible title="Review" defaultOpen={false}>
            <ReviewActions animName={selection.animName} />
          </Collapsible>
        </>
      );
  }
}

function CharacterSections() {
  return (
    <>
      <Collapsible title="Concept Pipeline" defaultOpen>
        <ConceptActions />
      </Collapsible>
      <Collapsible title="Sprite Generation" defaultOpen>
        <SpriteGenerationSection />
      </Collapsible>
      <Collapsible title="Atlas" defaultOpen>
        <AtlasActions />
      </Collapsible>
    </>
  );
}

function SpriteGenerationSection() {
  const manifest = useSeuratStore((s) => s.manifest);
  const generateFrames = useSeuratStore((s) => s.generateFrames);
  const [generatingAll, setGeneratingAll] = useState(false);

  if (!manifest) return null;

  const pendingCount = manifest.animations.reduce(
    (s, a) => s + a.frames.filter((f) => f.status === 'pending').length,
    0,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#888', marginBottom: 4 }}>
        Generate all pending animation frames ({pendingCount} pending across {manifest.animations.length} animations)
      </div>
      <button
        onClick={async () => {
          setGeneratingAll(true);
          try { await generateFrames('all_pending'); } finally { setGeneratingAll(false); }
        }}
        disabled={generatingAll || pendingCount === 0}
        style={{ ...styles.generateAllBtn, opacity: generatingAll || pendingCount === 0 ? 0.5 : 1 }}
      >
        {generatingAll ? 'Generating...' : `Generate All Animations (${pendingCount})`}
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  paneOuter: {
    width: 300,
    minWidth: 300,
    flexShrink: 0,
    background: '#111120',
    borderLeft: '1px solid #2a2a3a',
    position: 'relative' as const,
  },
  paneInner: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflowY: 'auto' as const,
    padding: 12,
  },
  collapsible: {
    borderRadius: 6,
    border: '1px solid #2a2a3a',
    overflow: 'hidden',
    marginBottom: 4,
  },
  collapseHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '8px 10px',
    background: '#161628',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  collapseArrow: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: '#666',
    width: 12,
    flexShrink: 0,
  },
  collapseTitle: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#aaa',
    fontWeight: 600,
    flex: 1,
  },
  collapseBadge: {
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 6px',
    borderRadius: 3,
    border: '1px solid #44aa44',
    color: '#70d870',
  },
  collapseBody: {
    padding: '8px 10px',
  },
  disabledMsg: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#886',
    background: '#2a2a1a',
    border: '1px solid #554422',
    borderRadius: 4,
    padding: '4px 6px',
  },
  generateAllBtn: {
    background: '#1e3a6e',
    border: '1px solid #4a8af8',
    borderRadius: 4,
    color: '#90b8f8',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 600,
    alignSelf: 'flex-start',
  },
  jobsSection: {
    background: '#131324',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    padding: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    marginTop: 4,
  },
  clearJobsBtn: {
    background: '#2a2a3a',
    border: '1px solid #444',
    borderRadius: 3,
    color: '#888',
    fontFamily: 'monospace',
    fontSize: 8,
    padding: '1px 6px',
    cursor: 'pointer',
  },
  jobRow: {
    display: 'flex',
    gap: 6,
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#aaa',
    padding: '1px 0',
  },
};
