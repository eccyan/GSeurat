import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';


/**
 * AssetsPanel data contract tests.
 *
 * These verify the store selectors and state shapes that AssetsPanel.tsx
 * consumes. RTL render tests are deferred until @testing-library/react is
 * added to the workspace.
 */

const makeAsset = (id: string, name: string) => ({
  id,
  kind: 'character' as const,
  characterName: name,
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  tags: [],
  currentFilename: null,
  colorPalettes: [],
});

describe('AssetsPanel data contract', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      asset: null,
      knownAssets: [],
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  });

  it('knownAssets is empty when no assets exist', () => {
    const s = useCharacterStore.getState();
    expect(s.knownAssets).toEqual([]);
    expect(s.asset).toBeNull();
  });

  it('knownAssets reflects listed assets', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    for (const [file, id, name] of [
      ['knight.echidna', 'knight', 'Knight'],
      ['mage.echidna', 'mage', 'Mage'],
    ] as const) {
      const fh = await saves.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ version: 3, id, characterName: name, voxels: [], parts: [], poses: {} }));
      await w.close();
    }

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
    });
    await useCharacterStore.getState().listAssets();

    const known = useCharacterStore.getState().knownAssets;
    expect(known).toHaveLength(2);
    const ids = known.map((c) => c.id).sort();
    expect(ids).toEqual(['knight', 'mage']);
  });

  it('current asset id matches asset.id selector', () => {
    useCharacterStore.setState({ asset: makeAsset('knight', 'Knight') });
    const s = useCharacterStore.getState();
    expect(s.asset?.id).toBe('knight');
  });

  it('dirty indicator is true only when dirty flag is set', () => {
    useCharacterStore.setState({
      asset: makeAsset('knight', 'Knight'),
      dirty: false,
    });
    expect(useCharacterStore.getState().dirty).toBe(false);

    useCharacterStore.getState().markDirty();
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('currentHasWork is true when undoStack or redoStack is non-empty', () => {
    useCharacterStore.setState({
      asset: makeAsset('knight', 'Knight'),
      dirty: false,
      undoStack: [{} as any],
      redoStack: [],
    });
    const s = useCharacterStore.getState();
    const currentHasWork = s.dirty || s.undoStack.length > 0 || s.redoStack.length > 0;
    expect(currentHasWork).toBe(true);
  });

  it('newAsset adds optimistic entry to knownAssets', () => {
    useCharacterStore.getState().newAsset('character', 32, 'Archer');
    const s = useCharacterStore.getState();
    expect(s.knownAssets).toHaveLength(1);
    expect(s.knownAssets[0].id).toBe('archer');
    expect(s.knownAssets[0].name).toBe('Archer');
    expect(s.asset?.id).toBe('archer');
  });
});
