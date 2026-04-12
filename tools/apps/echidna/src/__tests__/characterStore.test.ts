import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';
import { AssetListEntry, migrateEchidnaFile, ECHIDNA_FILE_VERSION } from '../store/types';

describe('migrateEchidnaFile v3 → v4', () => {
  it('defaults kind to character for legacy v3 files', () => {
    const raw = {
      version: 3, id: 'walker', characterName: 'Walker',
      gridWidth: 32, gridDepth: 32, voxels: [], parts: [], poses: {},
    };
    const result = migrateEchidnaFile(raw);
    expect(result.version).toBe(4);
    expect(result.kind).toBe('character');
  });

  it('preserves kind when already present', () => {
    const raw = {
      version: 4, id: 'crystal', kind: 'object', characterName: 'Crystal',
      gridWidth: 16, gridDepth: 16, voxels: [], parts: [], poses: {}, tags: ['prop'],
    };
    const result = migrateEchidnaFile(raw);
    expect(result.kind).toBe('object');
    expect(result.tags).toEqual(['prop']);
  });

  it('defaults tags to empty array', () => {
    const raw = { version: 3, id: 'test', characterName: 'Test', voxels: [], parts: [], poses: {} };
    const result = migrateEchidnaFile(raw);
    expect(result.tags).toEqual([]);
  });

  it('ECHIDNA_FILE_VERSION is 4', () => {
    expect(ECHIDNA_FILE_VERSION).toBe(4);
  });
});

describe('useCharacterStore — dirty tracking', () => {
  beforeEach(() => {
    // Ensure a non-null character is present so mutating actions don't early-return
    useCharacterStore.setState({
      asset: {
        id: '',
        kind: 'character' as const,
        characterName: 'Untitled',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
    });
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
    useCharacterStore.setState({ asset: null });
    useCharacterStore.getState().markClean();
    useCharacterStore.getState().addVoxel('0,0,0', { color: [255, 0, 0, 255] });
    expect(useCharacterStore.getState().asset).toBeNull();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });
});

describe('useCharacterStore.listAssets', () => {
  it('is a no-op when projectRootHandle is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: null,
      knownAssets: [],
    });
    await useCharacterStore.getState().listAssets();
    expect(useCharacterStore.getState().knownAssets).toEqual([]);
  });

  it('populates knownAssets from the project root', async () => {
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
      knownAssets: [],
    });

    await useCharacterStore.getState().listAssets();
    const known = useCharacterStore.getState().knownAssets;
    expect(known).toHaveLength(1);
    expect(known[0].id).toBe('walker');
    expect(known[0].name).toBe('Walker Bot');
  });

  it('preserves knownAssets on transient failure', async () => {
    const stale: AssetListEntry[] = [
      { id: 'old', kind: 'character', name: 'Old Character', lastModified: 1000 },
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
      knownAssets: stale,
    });

    await useCharacterStore.getState().listAssets();

    // The stale list should still be intact
    expect(useCharacterStore.getState().knownAssets).toEqual(stale);
  });
});

describe('useCharacterStore.openAsset', () => {
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

    await useCharacterStore.getState().openAsset('archer');

    const s = useCharacterStore.getState();
    expect(s.asset?.id).toBe('archer');
    expect(s.asset?.characterName).toBe('Archer');
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

    await useCharacterStore.getState().openAsset('mage');

    const s = useCharacterStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
    expect(s.boxSelection).toBeNull();
  });

  it('refreshes knownAssets and leaves state.character unchanged when file is missing', async () => {
    // Seed an empty project root — no .echidna files at all
    const root = testing.makeRoot();
    await root.getDirectoryHandle('tools_data', { create: true });
    // Not creating echidna_saves — opening any id will hit NotFoundError

    // Seed a stale known-characters list with a phantom entry, plus a
    // distinct existing character so we can detect unwanted reset.
    const existingChar = useCharacterStore.getState().asset;
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownAssets: [
        { id: 'ghost', kind: 'character', name: 'Ghost', lastModified: 0 },
      ],
    });

    await useCharacterStore.getState().openAsset('ghost');

    const s = useCharacterStore.getState();
    // knownAssets has been refreshed — the ghost entry dropped
    expect(s.knownAssets).toEqual([]);
    // state.character is unchanged (still whatever it was before the call)
    expect(s.asset).toEqual(existingChar);
  });

  it('resets mode to build when opening a non-character asset', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('town.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 4, id: 'town', kind: 'map', characterName: 'Town',
      gridWidth: 64, gridDepth: 64, voxels: [], parts: [], poses: {}, tags: [],
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
    });

    await useCharacterStore.getState().openAsset('town');

    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('map');
    expect(s.mode).toBe('build');
  });

  it('preserves mode when opening a character asset', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 4, id: 'archer', kind: 'character', characterName: 'Archer',
      gridWidth: 32, gridDepth: 32, voxels: [], parts: [], poses: {}, tags: [],
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      mode: 'animate',
    });

    await useCharacterStore.getState().openAsset('archer');

    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('character');
    expect(s.mode).toBe('animate');
  });
});

describe('useCharacterStore.save', () => {
  beforeEach(() => {
    // Reset race guard between tests so a prior test's save cannot block the next.
    useCharacterStore.setState({ _saving: false });
  });

  it('is a no-op when character is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: testing.makeRoot() as unknown as FileSystemDirectoryHandle,
      asset: null,
    });
    // Should not throw
    await useCharacterStore.getState().save();
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('writes the .echidna source + engine files and clears dirty', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker Bot',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [255, 0, 0, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
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

  it('second concurrent save() returns early via _saving race guard', async () => {
    // Seed a character so save() has something to write
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });

    // Two overlapping save calls — the second should return immediately
    // without triggering a second write pipeline. We can't easily spy on
    // the helpers without mocking, so we just verify both resolve without
    // throwing AND that _saving is false after both resolve.
    const p1 = useCharacterStore.getState().save();
    const p2 = useCharacterStore.getState().save();
    await Promise.all([p1, p2]);

    expect(useCharacterStore.getState()._saving).toBe(false);
    expect(useCharacterStore.getState().dirty).toBe(false);
  });

  it('partial-fail (.echidna succeeded but engine write failed) leaves dirty=true', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });

    // Force exportCharacterToProject to throw
    const projectFs = await import('../lib/projectFs');
    const spy = vi.spyOn(projectFs, 'exportCharacterToProject').mockRejectedValueOnce(
      new Error('simulated engine write failure')
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await useCharacterStore.getState().save();
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }

    // dirty should STILL be true — partial-fail means user needs to retry
    expect(useCharacterStore.getState().dirty).toBe(true);

    // The .echidna source should exist (succeeded before the failure)
    const td = await root.getDirectoryHandle('tools_data');
    const sv = await td.getDirectoryHandle('echidna_saves');
    await sv.getFileHandle('walker.echidna');  // throws if missing
  });

  it('returns early with a warning when projectRootHandle is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: null,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32, gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await useCharacterStore.getState().save();

    // Assert BEFORE restoring the spy (mockRestore clears call history).
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no projectRootHandle'));
    expect(useCharacterStore.getState().dirty).toBe(true);  // still dirty, save didn't happen
    expect(useCharacterStore.getState()._saving).toBe(false);  // race guard released

    warnSpy.mockRestore();
  });
});

describe('useCharacterStore.requestOpenAsset', () => {
  beforeEach(async () => {
    // Seed a project root with one target character
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3,
      id: 'archer',
      characterName: 'Archer',
      voxels: [],
      parts: [],
      poses: {},
    }));
    await w.close();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      // Use 'walker' as the "currently loaded" character so that tests which
      // open 'archer' are not caught by the re-entry guard (walker ≠ archer).
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: false,
      undoStack: [],
      knownAssets: [
        { id: 'archer', kind: 'character', name: 'Archer', lastModified: 0 },
      ],
    });
  });

  it('opens directly when dirty is false AND undoStack is empty', async () => {
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenAsset('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(false);
    expect(useCharacterStore.getState().asset?.id).toBe('archer');
  });

  it('invokes the confirm callback when dirty is true', async () => {
    useCharacterStore.setState({ dirty: true });
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenAsset('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(true);
    expect(useCharacterStore.getState().asset?.id).toBe('archer');
  });

  it('invokes the confirm callback when undoStack has entries', async () => {
    useCharacterStore.setState({ undoStack: [{} as any] });
    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenAsset('archer', async () => {
      confirmCalled = true;
      return 'discard';
    });
    expect(confirmCalled).toBe(true);
  });

  it('does NOT switch when user cancels', async () => {
    useCharacterStore.setState({ dirty: true });
    const initialCharId = useCharacterStore.getState().asset?.id;
    await useCharacterStore.getState().requestOpenAsset('archer', async () => 'cancel');
    expect(useCharacterStore.getState().asset?.id).toBe(initialCharId);
  });

  it('save decision: saves successfully and then switches', async () => {
    // Seed current character as dirty
    useCharacterStore.setState({
      dirty: true,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [255, 0, 0, 255] }]]),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
    });

    let confirmInfo: any = null;
    await useCharacterStore.getState().requestOpenAsset('archer', async (info) => {
      confirmInfo = info;
      return 'save';
    });

    // Confirm callback was invoked with the right info shape
    expect(confirmInfo).toBeTruthy();
    expect(confirmInfo.currentName).toBe('Walker');
    expect(confirmInfo.targetName).toBe('Archer');
    expect(typeof confirmInfo.undoDepth).toBe('number');

    // After save + switch: character is archer, dirty is false
    const s = useCharacterStore.getState();
    expect(s.asset?.id).toBe('archer');
    expect(s.dirty).toBe(false);
  });

  it('save decision: aborts switch when save fails', async () => {
    useCharacterStore.setState({
      dirty: true,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
    });

    // Force save() to fail partial-fail style by mocking exportCharacterToProject
    const projectFs = await import('../lib/projectFs');
    const spy = vi.spyOn(projectFs, 'exportCharacterToProject').mockRejectedValueOnce(
      new Error('simulated engine write failure')
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await useCharacterStore.getState().requestOpenAsset('archer', async () => 'save');
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }

    // After failed save: dirty still true, character is STILL walker (switch aborted)
    const s = useCharacterStore.getState();
    expect(s.asset?.id).toBe('walker');
    expect(s.dirty).toBe(true);
  });

  it('is a no-op when id equals currently-loaded character', async () => {
    // Seed current character
    useCharacterStore.setState({
      dirty: true,  // even when dirty
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32,
        gridDepth: 32,
        voxels: new Map(),
        characterParts: [],
        characterPoses: {},
        animations: {},
        tags: [],
        currentFilename: null,
      },
      undoStack: [{} as any],
    });

    let confirmCalled = false;
    await useCharacterStore.getState().requestOpenAsset('walker', async () => {
      confirmCalled = true;
      return 'discard';
    });

    // No confirm, no switch, no state change
    expect(confirmCalled).toBe(false);
    expect(useCharacterStore.getState().asset?.id).toBe('walker');
    expect(useCharacterStore.getState().dirty).toBe(true);  // still dirty — no-op means no clean
  });
});

describe('useCharacterStore.renameAsset', () => {
  it('renames the current character in-memory and marks dirty', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker', characterName: 'Walker Bot',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      knownAssets: [{ id: 'walker', kind: 'character', name: 'Walker Bot', lastModified: 0 }],
      dirty: false,
    });

    await useCharacterStore.getState().renameAsset('walker', 'Walker v2');

    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Walker v2');
    expect(s.knownAssets[0].name).toBe('Walker v2');
    expect(s.dirty).toBe(false);
  });

  it('writes the new name to disk even for the current character', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker', characterName: 'Walker Bot',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      knownAssets: [{ id: 'walker', kind: 'character', name: 'Walker Bot', lastModified: 0 }],
      dirty: false,
    });

    await useCharacterStore.getState().renameAsset('walker', 'Walker v2');

    // In-memory state updated
    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Walker v2');
    expect(s.knownAssets[0].name).toBe('Walker v2');

    // Disk file also updated
    const fh2 = await saves.getFileHandle('walker.echidna');
    const file2 = await fh2.getFile();
    const parsed = JSON.parse(await file2.text());
    expect(parsed.characterName).toBe('Walker v2');
  });

  it('renames a non-current character on disk without touching state.character', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('archer.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'archer', characterName: 'Archer', voxels: [], parts: [], poses: {},
    }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker', characterName: 'Walker Bot',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      knownAssets: [
        { id: 'walker', kind: 'character', name: 'Walker Bot', lastModified: 0 },
        { id: 'archer', kind: 'character', name: 'Archer', lastModified: 0 },
      ],
      dirty: false,
    });

    await useCharacterStore.getState().renameAsset('archer', 'Ace Archer');

    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Walker Bot');        // unchanged
    expect(s.knownAssets.find((c) => c.id === 'archer')?.name).toBe('Ace Archer');
    expect(s.dirty).toBe(false);                                    // still clean
  });
});

describe('useCharacterStore.deleteAsset', () => {
  it('removes the row from knownAssets', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownAssets: [
        { id: 'walker', kind: 'character', name: 'Walker', lastModified: 0 },
        { id: 'archer', kind: 'character', name: 'Archer', lastModified: 0 },
      ],
      // character is not walker, so deleting walker should not null it
      asset: {
        id: 'archer',
        kind: 'character' as const,
        characterName: 'Archer',
        gridWidth: 32, gridDepth: 32,
        voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
    });

    await useCharacterStore.getState().deleteAsset('walker');

    expect(useCharacterStore.getState().knownAssets.map((c) => c.id)).toEqual(['archer']);
    // Non-current character deletion should not touch state.character
    expect(useCharacterStore.getState().asset?.id).toBe('archer');
  });

  it('clears state.character to null when deleting the current character', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker',
        kind: 'character' as const,
        characterName: 'Walker',
        gridWidth: 32, gridDepth: 32,
        voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      knownAssets: [{ id: 'walker', kind: 'character', name: 'Walker', lastModified: 0 }],
      dirty: true,
      undoStack: [{} as any],
    });

    await useCharacterStore.getState().deleteAsset('walker');

    const s = useCharacterStore.getState();
    expect(s.asset).toBeNull();
    expect(s.dirty).toBe(false);
    expect(s.knownAssets).toEqual([]);
    expect(s.undoStack).toEqual([]);
  });
});

describe('useCharacterStore.duplicateAsset', () => {
  it('appends a numeric suffix when newId collides', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    for (const [name, id] of [
      ['walker.echidna', 'walker'],
      ['walker_2.echidna', 'walker_2'],
    ] as const) {
      const fh = await saves.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ version: 3, id, characterName: id, voxels: [], parts: [], poses: {} }));
      await w.close();
    }

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      knownAssets: [
        { id: 'walker', kind: 'character', name: 'Walker', lastModified: 0 },
        { id: 'walker_2', kind: 'character', name: 'Walker', lastModified: 0 },
      ],
    });

    await useCharacterStore.getState().duplicateAsset('walker', 'Walker');
    // Expected: new id is walker_3 (since walker and walker_2 already exist)

    const known = useCharacterStore.getState().knownAssets;
    expect(known.map((c) => c.id).sort()).toEqual(['walker', 'walker_2', 'walker_3']);
  });

  it('does not auto-open the duplicate', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: null,
      knownAssets: [{ id: 'walker', kind: 'character', name: 'Walker', lastModified: 0 }],
    });

    await useCharacterStore.getState().duplicateAsset('walker', 'Archer');
    expect(useCharacterStore.getState().asset).toBeNull();  // still null
  });
});

describe('useCharacterStore.newAsset — name parameter', () => {
  beforeEach(() => {
    useCharacterStore.setState({ knownAssets: [], asset: null, dirty: false });
  });

  it('uses the provided name and derives id from it', () => {
    useCharacterStore.getState().newAsset('character',32, 'Knight');
    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Knight');
    expect(s.asset?.id).toBe('knight');
  });

  it('falls back to Untitled when name is undefined', () => {
    useCharacterStore.getState().newAsset('character',32);
    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Untitled');
    expect(s.asset?.id).toBe('untitled');
  });

  it('falls back to Untitled when name is empty string', () => {
    useCharacterStore.getState().newAsset('character',32, '');
    const s = useCharacterStore.getState();
    expect(s.asset?.characterName).toBe('Untitled');
  });

  it('deduplicates id when name collides with existing character', () => {
    useCharacterStore.setState({
      knownAssets: [{ id: 'knight', kind: 'character', name: 'Knight', lastModified: 0 }],
      asset: null,
      dirty: false,
    });
    useCharacterStore.getState().newAsset('character',32, 'Knight');
    const s = useCharacterStore.getState();
    expect(s.asset?.id).toBe('knight_2');
  });
});

describe('useCharacterStore.saveProject — null guard', () => {
  it('throws when character is null', () => {
    useCharacterStore.setState({ asset: null });
    expect(() => useCharacterStore.getState().saveProject()).toThrow(
      '[echidna] saveProject called with null character',
    );
  });
});

describe('useCharacterStore.save — return value', () => {
  beforeEach(() => {
    useCharacterStore.setState({ _saving: false });
  });

  it('returns true on successful save', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker', characterName: 'Walker',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(true);
  });

  it('returns false when projectRootHandle is null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCharacterStore.setState({
      projectRootHandle: null,
      asset: {
        id: 'walker', characterName: 'Walker',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
    warnSpy.mockRestore();
  });

  it('returns false when character is null', async () => {
    useCharacterStore.setState({
      projectRootHandle: testing.makeRoot() as unknown as FileSystemDirectoryHandle,
      asset: null,
    });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
  });

  it('returns false when race guard blocks', async () => {
    useCharacterStore.setState({ _saving: true });
    const result = await useCharacterStore.getState().save();
    expect(result).toBe(false);
  });

  it('returns false on partial failure', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'walker', characterName: 'Walker',
        kind: 'character' as const,
        gridWidth: 32, gridDepth: 32, voxels: new Map(),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [],
        currentFilename: null,
      },
      dirty: true,
    });
    const projectFs = await import('../lib/projectFs');
    const spy = vi.spyOn(projectFs, 'exportCharacterToProject').mockRejectedValueOnce(
      new Error('simulated engine write failure'),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await useCharacterStore.getState().save();
      expect(result).toBe(false);
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

describe('useCharacterStore.newAsset — kind parameter', () => {
  beforeEach(() => {
    useCharacterStore.setState({ knownAssets: [], asset: null, dirty: false });
  });

  it('creates a map asset with no parts or poses', () => {
    useCharacterStore.getState().newAsset('map', 64, 'Town');
    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('map');
    expect(s.asset?.id).toBe('town');
    expect(s.asset?.characterParts).toEqual([]);
    expect(s.knownAssets[0].kind).toBe('map');
  });

  it('creates an object asset', () => {
    useCharacterStore.getState().newAsset('object', 16, 'Crystal');
    const s = useCharacterStore.getState();
    expect(s.asset?.kind).toBe('object');
    expect(s.asset?.id).toBe('crystal');
    expect(s.knownAssets[0].kind).toBe('object');
  });
});

describe('useCharacterStore.save — map kind', () => {
  beforeEach(() => { useCharacterStore.setState({ _saving: false }); });

  it('writes PLY to assets/maps/ without manifest', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'town', kind: 'map', characterName: 'Town',
        gridWidth: 32, gridDepth: 32,
        voxels: new Map([['0,0,0', { color: [100, 150, 100, 255] }]]),
        characterParts: [], characterPoses: {}, animations: {},
        tags: [], currentFilename: null,
      },
      dirty: true,
    });
    const ok = await useCharacterStore.getState().save();
    expect(ok).toBe(true);
    expect(useCharacterStore.getState().dirty).toBe(false);
    const assets = await root.getDirectoryHandle('assets');
    const maps = await assets.getDirectoryHandle('maps');
    await maps.getFileHandle('town.ply');
  });
});

describe('useCharacterStore.save — object kind', () => {
  beforeEach(() => { useCharacterStore.setState({ _saving: false }); });

  it('writes PLY to assets/objects/ without manifest', async () => {
    const root = testing.makeRoot();
    useCharacterStore.setState({
      projectRootHandle: root as unknown as FileSystemDirectoryHandle,
      asset: {
        id: 'crystal', kind: 'object', characterName: 'Crystal',
        gridWidth: 16, gridDepth: 16,
        voxels: new Map([['0,0,0', { color: [200, 200, 255, 255] }]]),
        characterParts: [], characterPoses: {}, animations: {},
        tags: ['prop'], currentFilename: null,
      },
      dirty: true,
    });
    const ok = await useCharacterStore.getState().save();
    expect(ok).toBe(true);
    const assets = await root.getDirectoryHandle('assets');
    const objects = await assets.getDirectoryHandle('objects');
    await objects.getFileHandle('crystal.ply');
  });
});
