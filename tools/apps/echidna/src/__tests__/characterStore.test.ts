import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore';

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
