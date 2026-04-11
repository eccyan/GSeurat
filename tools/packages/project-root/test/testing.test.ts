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
