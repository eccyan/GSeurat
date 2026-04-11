import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';
import { CharacterListEntry } from '../store/types';

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

  it('preserves knownCharacters on transient failure', async () => {
    const stale: CharacterListEntry[] = [
      { id: 'old', name: 'Old Character', lastModified: 1000 },
    ];
    useCharacterStore.setState({
      // Bogus handle that will make listEchidnaProjects throw when it tries
      // to call getDirectoryHandle on it. The function catches NotFoundError
      // and returns [], but any OTHER error propagates up and gets caught by
      // the store action, which must then preserve the existing list.
      projectRootHandle: {
        async getDirectoryHandle() {
          throw new Error('simulated transient failure');
        },
      } as unknown as FileSystemDirectoryHandle,
      knownCharacters: stale,
    });

    await useCharacterStore.getState().listCharacters();

    // The stale list should still be intact
    expect(useCharacterStore.getState().knownCharacters).toEqual(stale);
  });
});

describe('useCharacterStore.openCharacter', () => {
  it('preserves global slice when switching characters', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3,
      id: 'archer',
      characterName: 'Archer',
      gridWidth: 24,
      gridDepth: 24,
      voxels: [],
      parts: [],
      poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
      xrayMode: true,
    });

    await useCharacterStore.getState().openCharacter('archer');

    const s = useCharacterStore.getState();
    expect(s.character?.id).toBe('archer');
    expect(s.character?.characterName).toBe('Archer');
    expect(s.mode).toBe('animate');         // global preserved
    expect(s.xrayMode).toBe(true);           // global preserved
  });

  it('clears dirty flag, undo/redo stacks, and selection state', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('mage.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'mage', characterName: 'Mage', voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      dirty: true,
      undoStack: [{} as any, {} as any],
      redoStack: [{} as any],
      boxSelection: ['0,0,0', '1,1,1'] as any,
    });

    await useCharacterStore.getState().openCharacter('mage');

    const s = useCharacterStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
    expect(s.boxSelection).toBeNull();
  });

  it('refreshes knownCharacters and leaves state.character unchanged when file is missing', async () => {
    // Seed an empty project root — no .echidna files at all
    const root = testing.makeRoot();
    await root.getDirectoryHandle('tools_data', { create: true });
    // Not creating echidna_saves — opening any id will hit NotFoundError

    // Seed a stale known-characters list with a phantom entry, plus a
    // distinct existing character so we can detect unwanted reset.
    const existingChar = useCharacterStore.getState().character;
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownCharacters: [
        { id: 'ghost', name: 'Ghost', lastModified: 0 },
      ],
    });

    await useCharacterStore.getState().openCharacter('ghost');

    const s = useCharacterStore.getState();
    // knownCharacters has been refreshed — the ghost entry dropped
    expect(s.knownCharacters).toEqual([]);
    // state.character is unchanged (still whatever it was before the call)
    expect(s.character).toEqual(existingChar);
  });
});

describe('useCharacterStore.save', () => {
  it('is a no-op when character is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: testing.makeRoot() as unknown as FileSystemDirectoryHandle,
      character: null,
    });
    // Should not throw
    await useCharacterStore.getState().save();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('writes the .echidna source + engine files and clears dirty', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      character: {
        id: 'walker',
        characterName: 'Walker Bot',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [255, 0, 0, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        currentFilename: null,
      },
      dirty: true,
    });

    await useCharacterStore.getState().save();

    // Dirty should clear
    expect(useCharacterStore.getState().dirty).toBe(false);

    // The .echidna source file should exist at tools_data/echidna_saves/walker.echidna
    const td = await root.getDirectoryHandle('tools_data');
    const sv = await td.getDirectoryHandle('echidna_saves');
    const fh = await sv.getFileHandle('walker.echidna');
    const file = await fh.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe('walker');
    expect(parsed.characterName).toBe('Walker Bot');

    // The engine-ready files should exist at assets/characters/walker/*
    const assets = await root.getDirectoryHandle('assets');
    const chars = await assets.getDirectoryHandle('characters');
    const walkerDir = await chars.getDirectoryHandle('walker');
    await walkerDir.getFileHandle('walker.ply');           // throws if missing
    await walkerDir.getFileHandle('walker.manifest.json'); // throws if missing
  });
});
