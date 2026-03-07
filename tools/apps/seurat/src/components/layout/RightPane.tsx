import React from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ManifestJsonEditor } from '../manifest/ManifestJsonEditor.js';
import { ConceptActions } from '../concept/ConceptActions.js';
import { AtlasActions } from '../atlas/AtlasActions.js';
import { GenerateActions } from '../generate/GenerateActions.js';
import { ReviewActions } from '../review/ReviewActions.js';

export function RightPane() {
  const treeSelection = useSeuratStore((s) => s.treeSelection);

  return (
    <div style={styles.pane}>
      <RightContent selection={treeSelection} />
    </div>
  );
}

function RightContent({ selection }: { selection: ReturnType<typeof useSeuratStore.getState>['treeSelection'] }) {
  switch (selection.kind) {
    case 'manifest':
      return <ManifestJsonEditor />;
    case 'character':
      return (
        <>
          <ConceptActions />
          <AtlasActions />
        </>
      );
    case 'animation':
      return (
        <>
          <GenerateActions animName={selection.animName} />
          <div style={{ height: 1, background: '#2a2a3a', margin: '8px 0' }} />
          <ReviewActions animName={selection.animName} />
        </>
      );
  }
}

const styles: Record<string, React.CSSProperties> = {
  pane: {
    width: 300,
    flexShrink: 0,
    background: '#111120',
    borderLeft: '1px solid #2a2a3a',
    overflowY: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
};
