const TRAVERSAL_RE = /(^|\/)\.\.($|\/)/;

function splitPath(p: string): string[] {
  if (!p || p.length === 0) {
    throw new Error('path is empty');
  }
  if (TRAVERSAL_RE.test(p)) {
    throw new Error(`path contains traversal: "${p}"`);
  }
  return p.split('/').filter(s => s.length > 0);
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
  content: string | Uint8Array,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (fileHandle as any).getFile();
}

/** Returns true if a file exists at `relativePath` under `root`. */
export async function fileExistsAtPath(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<boolean> {
  try {
    await readFileAtPath(root, relativePath);
    return true;
  } catch {
    return false;
  }
}
