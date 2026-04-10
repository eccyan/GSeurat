function splitPath(p: string): string[] {
  if (!p || p.length === 0) {
    throw new Error('path is empty');
  }
  const parts = p.split('/').filter(s => s.length > 0);
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`path contains traversal: "${p}"`);
    }
  }
  return parts;
}

/**
 * Ensure a subdirectory exists under `root`, creating any missing intermediate
 * directories. Returns a handle to the deepest directory.
 */
export async function ensureSubdir(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('ensureSubdir: empty path');
  }
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  return cur;
}

/**
 * Write `content` to a file at `relativePath` under `root`, creating any
 * missing intermediate directories. Overwrites existing content.
 */
export async function writeFileAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  content: string | Uint8Array | Blob,
): Promise<void> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('writeFileAtPath: empty path');
  }
  const filename = parts.pop() as string;
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await cur.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content as FileSystemWriteChunkType);
  await writable.close();
}

/**
 * Read the file at `relativePath` under `root`, returning a Blob.
 * Throws if any path segment does not exist.
 */
export async function readFileAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<Blob> {
  const parts = splitPath(relativePath);
  if (parts.length === 0) {
    throw new Error('readFileAtPath: empty path');
  }
  const filename = parts.pop() as string;
  let cur: FileSystemDirectoryHandle = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create: false });
  }
  const fileHandle = await cur.getFileHandle(filename, { create: false });
  return await fileHandle.getFile();
}

/** Returns true if a file exists at `relativePath` under `root`. */
export async function fileExistsAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  // Let traversal errors propagate rather than being swallowed.
  splitPath(relativePath);
  try {
    await readFileAtPath(root, relativePath);
    return true;
  } catch {
    return false;
  }
}
