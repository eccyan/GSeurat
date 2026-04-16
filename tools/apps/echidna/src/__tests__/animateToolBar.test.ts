import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../store/useCharacterStore.js';

describe('setMode resets activeTool to orbit', () => {
  beforeEach(() => {
    useCharacterStore.setState({ mode: 'build', activeTool: 'place' });
  });

  it('resets activeTool to orbit when switching to animate', () => {
    useCharacterStore.getState().setMode('animate');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });

  it('resets activeTool to orbit when switching to build', () => {
    useCharacterStore.setState({ mode: 'animate', activeTool: 'assign_part' });
    useCharacterStore.getState().setMode('build');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });

  it('orbit tool can be set in both modes', () => {
    useCharacterStore.getState().setMode('build');
    useCharacterStore.getState().setTool('orbit');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');

    useCharacterStore.getState().setMode('animate');
    useCharacterStore.getState().setTool('orbit');
    expect(useCharacterStore.getState().activeTool).toBe('orbit');
  });
});
