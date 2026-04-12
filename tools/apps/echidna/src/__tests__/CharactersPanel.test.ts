import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';
import { testing } from '@gseurat/project-root';
import type { CharacterListEntry } from '../store/types';

/**
 * CharactersPanel data contract tests.
 *
 * These verify the store selectors and state shapes that CharactersPanel.tsx
 * consumes. RTL render tests are deferred until @testing-library/react is
 * added to the workspace.
 */

const makeCharacter = (id: string, name: string) => ({
  id,
  characterName: name,
  gridWidth: 32,
  gridDepth: 32,
  voxels: new Map(),
  characterParts: [],
  characterPoses: {},
  animations: {},
  currentFilename: null,
});

describe('CharactersPanel data contract', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      character: null,
      knownCharacters: [],
      dirty: false,
      undoStack: [],
      redoStack: [],
    });
  });

  it('knownCharacters is empty when no characters exist', () => {
    const s = useCharacterStore.getState();
    expect(s.knownCharacters).toEqual([]);
    expect(s.character).toBeNull();
  });

  it('knownCharacters reflects listed characters', async () => {
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
    await useCharacterStore.getState().listCharacters();

    const known = useCharacterStore.getState().knownCharacters;
    expect(known).toHaveLength(2);
    const ids = known.map((c) => c.id).sort();
    expect(ids).toEqual(['knight', 'mage']);
  });

  it('current character id matches character.id selector', () => {
    useCharacterStore.setState({ character: makeCharacter('knight', 'Knight') });
    const s = useCharacterStore.getState();
    expect(s.character?.id).toBe('knight');
  });

  it('dirty indicator is true only when dirty flag is set', () => {
    useCharacterStore.setState({
      character: makeCharacter('knight', 'Knight'),
      dirty: false,
    });
    expect(useCharacterStore.getState().dirty).toBe(false);

    useCharacterStore.getState().markDirty();
    expect(useCharacterStore.getState().dirty).toBe(true);
  });

  it('currentHasWork is true when undoStack or redoStack is non-empty', () => {
    useCharacterStore.setState({
      character: makeCharacter('knight', 'Knight'),
      dirty: false,
      undoStack: [{} as any],
      redoStack: [],
    });
    const s = useCharacterStore.getState();
    const currentHasWork = s.dirty || s.undoStack.length > 0 || s.redoStack.length > 0;
    expect(currentHasWork).toBe(true);
  });

  it('newCharacter adds optimistic entry to knownCharacters', () => {
    useCharacterStore.getState().newCharacter(32, 'Archer');
    const s = useCharacterStore.getState();
    expect(s.knownCharacters).toHaveLength(1);
    expect(s.knownCharacters[0].id).toBe('archer');
    expect(s.knownCharacters[0].name).toBe('Archer');
    expect(s.character?.id).toBe('archer');
  });
});
