import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';

describe('useCharacterStore — dirty tracking', () => {
  beforeEach(() => {
    useCharacterStore.getState().markClean();
  });

  it('markDirty sets dirty to true', () => {
    useCharacterStore.getState().markDirty();
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('markClean sets dirty to false', () => {
    useCharacterStore.getState().markDirty();
    useCharacterStore.getState().markClean();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('addVoxel triggers markDirty automatically', () => {
    const s = useCharacterStore.getState();
    expect(s.dirty).toBe(false);
    s.addVoxel('0,0,0', { color: [255, 0, 0, 255] });
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('setCharacterName triggers markDirty automatically', () => {
    const s = useCharacterStore.getState();
    s.markClean();
    s.setCharacterName('Test Character');
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('addVoxel on null character is a no-op and does NOT dirty the state', () => {
    useCharacterStore.setState({ character: null });
    useCharacterStore.getState().markClean();
    useCharacterStore.getState().addVoxel('0,0,0', { color: [255, 0, 0, 255] });
    expect(useCharacterStore.getState().character).toBeNull();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });
});

describe('useCharacterStore.listCharacters', () => {
  it('is a no-op when projectRootHandle is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: null,
      knownCharacters: [],
    });
    await useCharacterStore.getState().listCharacters();
    expect(useCharacterStore.getState().knownCharacters).toEqual([]);
  });

  it('populates knownCharacters from the project root', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3,
      id: 'walker',
      characterName: 'Walker Bot',
      voxels: [],
      parts: [],
      poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownCharacters: [],
    });

    await useCharacterStore.getState().listCharacters();
    const known = useCharacterStore.getState().knownCharacters;
    expect(known).toHaveLength(1);
    expect(known[0].id).toBe('walker');
    expect(known[0].name).toBe('Walker Bot');
  });
});
