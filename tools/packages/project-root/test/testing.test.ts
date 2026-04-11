import { describe, it, expect } from 'vitest';
import { makeRoot } from '../src/testing';

describe('MockDirHandle.removeEntry', () => {
  it('removes a file from the parent directory', async () => {
    const root = makeRoot();
    const fh = await root.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write('hello');
    await w.close();

    // Confirm the file exists first
    await root.getFileHandle('walker.echidna');

    await root.removeEntry('walker.echidna');

    await expect(root.getFileHandle('walker.echidna')).rejects.toThrow(/NotFoundError/);
  });

  it('throws NotFoundError when removing a nonexistent entry', async () => {
    const root = makeRoot();
    await expect(root.removeEntry('ghost')).rejects.toThrow(/NotFoundError/);
  });

  it('removes a subdirectory', async () => {
    const root = makeRoot();
    await root.getDirectoryHandle('tools_data', { create: true });
    await root.removeEntry('tools_data');
    await expect(root.getDirectoryHandle('tools_data')).rejects.toThrow(/NotFoundError/);
  });
});

describe('MockDirHandle async iteration', () => {
  it('values() yields file handles', async () => {
    const root = makeRoot();
    for (const name of ['a.echidna', 'b.echidna', 'c.echidna']) {
      const fh = await root.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(name);
      await w.close();
    }

    const names: string[] = [];
    for await (const handle of root.values()) {
      names.push(handle.name);
    }
    expect(names.sort()).toEqual(['a.echidna', 'b.echidna', 'c.echidna']);
  });

  it('values() distinguishes file handles from dir handles by kind', async () => {
    const root = makeRoot();
    await root.getFileHandle('file.txt', { create: true });
    await root.getDirectoryHandle('subdir', { create: true });

    const kinds: string[] = [];
    for await (const handle of root.values()) {
      kinds.push(handle.kind);
    }
    expect(kinds.sort()).toEqual(['directory', 'file']);
  });

  it('values() yields nothing for empty directories', async () => {
    const root = makeRoot();
    const names: string[] = [];
    for await (const handle of root.values()) {
      names.push((handle as { name: string }).name);
    }
    expect(names).toEqual([]);
  });
});
