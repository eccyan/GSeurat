// tools/packages/project-root/src/testing.ts
//
// Minimal in-memory mock matching the FileSystemDirectoryHandle subset we use.
// Promoted from test/fs.test.ts so Echidna (and future editors) can reuse it
// when testing FSAPI wrappers.

type Node =
  | { kind: 'dir'; entries: Map<string, Node> }
  | { kind: 'file'; data: Uint8Array };

export class MockDirHandle {
  kind: 'directory' = 'directory';
  constructor(
    public node: Extract<Node, { kind: 'dir' }>,
    public name = '',
  ) {}

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirHandle> {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) {
        const e: any = new Error(`NotFoundError: ${name}`);
        e.name = 'NotFoundError';
        throw e;
      }
      n = { kind: 'dir', entries: new Map() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'dir') {
      const e: any = new Error(`TypeMismatchError: ${name}`);
      e.name = 'TypeMismatchError';
      throw e;
    }
    return new MockDirHandle(n, name);
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let n = this.node.entries.get(name);
    if (!n) {
      if (!opts?.create) {
        const e: any = new Error(`NotFoundError: ${name}`);
        e.name = 'NotFoundError';
        throw e;
      }
      n = { kind: 'file', data: new Uint8Array() };
      this.node.entries.set(name, n);
    }
    if (n.kind !== 'file') {
      const e: any = new Error(`TypeMismatchError: ${name}`);
      e.name = 'TypeMismatchError';
      throw e;
    }
    return this.makeFileHandle(name, n);
  }

  private makeFileHandle(name: string, file: Extract<Node, { kind: 'file' }>) {
    return {
      kind: 'file' as const,
      name,
      createWritable: async () => ({
        write: async (d: Uint8Array | string | ArrayBuffer | Blob) => {
          let bytes: Uint8Array;
          if (typeof d === 'string') bytes = new TextEncoder().encode(d);
          else if (d instanceof Blob) bytes = new Uint8Array(await d.arrayBuffer());
          else if (d instanceof Uint8Array) bytes = d;
          else bytes = new Uint8Array(d);
          file.data = bytes;
        },
        close: async () => {},
      }),
      getFile: async () =>
        new File([file.data as Uint8Array<ArrayBuffer>], name, {
          lastModified: Date.now(),
        }),
    };
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }): Promise<void> {
    if (!this.node.entries.has(name)) {
      const e: any = new Error(`NotFoundError: ${name}`);
      e.name = 'NotFoundError';
      throw e;
    }
    this.node.entries.delete(name);
  }

  async *values(): AsyncGenerator<MockDirHandle | ReturnType<MockDirHandle['makeFileHandle']>> {
    for (const [name, child] of this.node.entries) {
      if (child.kind === 'dir') {
        yield new MockDirHandle(child, name);
      } else {
        yield this.makeFileHandle(name, child);
      }
    }
  }
}

export function makeRoot(): MockDirHandle {
  return new MockDirHandle({ kind: 'dir', entries: new Map() });
}
