import { describe, it, expect, beforeEach } from 'vitest';
import { useVfxStore } from '../useVfxStore';

describe('useVfxStore — ensureProjectName', () => {
  beforeEach(() => {
    useVfxStore.setState({ projectName: 'Untitled' });
  });

  it('returns the existing name when set to a real value', () => {
    useVfxStore.setState({ projectName: 'Forest Demo' });
    expect(useVfxStore.getState().ensureProjectName()).toBe('Forest Demo');
    expect(useVfxStore.getState().projectName).toBe('Forest Demo');
  });

  it('returns "Untitled" and stores it when name is empty', () => {
    useVfxStore.setState({ projectName: '' });
    expect(useVfxStore.getState().ensureProjectName()).toBe('Untitled');
    expect(useVfxStore.getState().projectName).toBe('Untitled');
  });

  it('returns "Untitled" when name is whitespace-only', () => {
    useVfxStore.setState({ projectName: '   ' });
    expect(useVfxStore.getState().ensureProjectName()).toBe('Untitled');
    expect(useVfxStore.getState().projectName).toBe('Untitled');
  });

  it('returns "Untitled" when projectName is the default — caller must prompt', () => {
    expect(useVfxStore.getState().ensureProjectName()).toBe('Untitled');
  });

  it('treats names containing "Untitled" as user-set if differing from the default', () => {
    useVfxStore.setState({ projectName: 'Untitled v2' });
    expect(useVfxStore.getState().ensureProjectName()).toBe('Untitled v2');
  });
});
