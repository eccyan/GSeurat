import { describe, it, expect } from 'vitest';
import { ensureSubdir, writeFileAtPath, readFileAtPath, fileExistsAtPath } from '../src/fs';
import { MockDirHandle, makeRoot } from '../src/testing';

describe('ensureSubdir', () => {
  it('creates nested subdirectories', async () => {
    const root = makeRoot();
    const handle = await ensureSubdir(root as any, 'assets/characters/walker');
    expect(handle.name).toBe('walker');
    // Check the parent chain exists
    const assets = await (root as any).getDirectoryHandle('assets');
    const characters = await assets.getDirectoryHandle('characters');
    await characters.getDirectoryHandle('walker'); // throws if missing
  });

  it('is idempotent', async () => {
    const root = makeRoot();
    await ensureSubdir(root as any, 'assets/foo');
    await ensureSubdir(root as any, 'assets/foo'); // should not throw
  });

  it('returns the root when path is a single segment', async () => {
    const root = makeRoot();
    const handle = await ensureSubdir(root as any, 'assets');
    expect(handle.name).toBe('assets');
  });

  it('rejects empty path', async () => {
    const root = makeRoot();
    await expect(ensureSubdir(root as any, '')).rejects.toThrow(/empty/i);
  });

  it('rejects traversal', async () => {
    const root = makeRoot();
    await expect(ensureSubdir(root as any, 'assets/../evil')).rejects.toThrow(/traversal/i);
  });

  it('rejects single-dot segment', async () => {
    const root = makeRoot();
    await expect(ensureSubdir(root as any, 'assets/./foo')).rejects.toThrow(/traversal/i);
  });
});

describe('writeFileAtPath / readFileAtPath', () => {
  it('round-trips text content', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'assets/scenes/town.json', '{"hello":"world"}');
    const blob = await readFileAtPath(root as any, 'assets/scenes/town.json');
    const text = await blob.text();
    expect(text).toBe('{"hello":"world"}');
  });

  it('round-trips binary content', async () => {
    const root = makeRoot();
    const bytes = new Uint8Array([1, 2, 3, 4, 255, 0, 128]);
    await writeFileAtPath(root as any, 'assets/maps/town.ply', bytes);
    const blob = await readFileAtPath(root as any, 'assets/maps/town.ply');
    const arr = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(arr)).toEqual([1, 2, 3, 4, 255, 0, 128]);
  });

  it('creates intermediate directories on write', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'tools_data/bricklayer/deep/nested/scene.bricklayer', '{}');
    const blob = await readFileAtPath(root as any, 'tools_data/bricklayer/deep/nested/scene.bricklayer');
    expect(await blob.text()).toBe('{}');
  });

  it('overwrites existing file content', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'assets/scenes/town.json', 'v1');
    await writeFileAtPath(root as any, 'assets/scenes/town.json', 'v2');
    const blob = await readFileAtPath(root as any, 'assets/scenes/town.json');
    expect(await blob.text()).toBe('v2');
  });

  it('rejects empty path on write', async () => {
    const root = makeRoot();
    await expect(writeFileAtPath(root as any, '', 'data')).rejects.toThrow(/empty/i);
  });

  it('rejects traversal on write', async () => {
    const root = makeRoot();
    await expect(writeFileAtPath(root as any, 'assets/../evil.txt', 'x')).rejects.toThrow(/traversal/i);
  });

  it('rejects traversal on read', async () => {
    const root = makeRoot();
    await expect(readFileAtPath(root as any, 'assets/../evil.txt')).rejects.toThrow(/traversal/i);
  });

  it('rejects single-dot current-dir segment on write', async () => {
    const root = makeRoot();
    await expect(writeFileAtPath(root as any, 'assets/./foo.json', '{}')).rejects.toThrow(/traversal/i);
  });

  it('accepts Blob content', async () => {
    const root = makeRoot();
    const blob = new Blob(['hello from blob'], { type: 'text/plain' });
    await writeFileAtPath(root as any, 'assets/scenes/blob.json', blob);
    const read = await readFileAtPath(root as any, 'assets/scenes/blob.json');
    expect(await read.text()).toBe('hello from blob');
  });

  it('normalizes trailing slash and double slashes', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'assets//scenes/test.json', '1');
    expect(await fileExistsAtPath(root as any, 'assets/scenes/test.json')).toBe(true);
  });
});

describe('fileExistsAtPath', () => {
  it('returns true when the file exists', async () => {
    const root = makeRoot();
    await writeFileAtPath(root as any, 'assets/scenes/town.json', '{}');
    expect(await fileExistsAtPath(root as any, 'assets/scenes/town.json')).toBe(true);
  });

  it('returns false when the file does not exist', async () => {
    const root = makeRoot();
    expect(await fileExistsAtPath(root as any, 'assets/scenes/missing.json')).toBe(false);
  });

  it('returns false for a missing intermediate directory', async () => {
    const root = makeRoot();
    expect(await fileExistsAtPath(root as any, 'assets/nonexistent/file.json')).toBe(false);
  });

  it('propagates traversal error instead of returning false', async () => {
    const root = makeRoot();
    await expect(fileExistsAtPath(root as any, 'assets/../evil.txt')).rejects.toThrow(/traversal/i);
  });
});
