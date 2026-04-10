import { get, set, del } from 'idb-keyval';

const KEY_PREFIX = 'gseurat:project-root-handle:';

/**
 * This module is tested via editor integration (Tasks 13, 16, 21) rather
 * than unit tests — IDB and FSAPI's permission methods both require a
 * browser runtime, and the logic here is a thin pass-through.
 */

/**
 * Persist a directory handle in IndexedDB so future sessions can re-acquire it.
 * The browser still requires re-prompting for permission via requestPermission()
 * on subsequent sessions — see ensureHandlePermission() / restoreProjectRoot().
 *
 * `appId` scopes the handle per editor so Echidna, Méliès, and Bricklayer can
 * each remember their own project root independently.
 */
export async function saveProjectRootHandle(
  appId: string,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(KEY_PREFIX + appId, handle);
}

/**
 * Load a previously stored directory handle. Returns null if none is stored.
 * Does NOT check or request permission — use ensureHandlePermission() or
 * restoreProjectRoot() for that.
 */
export async function loadProjectRootHandle(
  appId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await get<FileSystemDirectoryHandle>(KEY_PREFIX + appId);
  return handle ?? null;
}

/** Remove a stored handle for this appId. */
export async function clearProjectRootHandle(appId: string): Promise<void> {
  await del(KEY_PREFIX + appId);
}

/**
 * Query, then request if needed, read/write permission on a previously stored
 * directory handle. Returns true if permission is granted.
 *
 * The browser usually grants silently on the first call if the user previously
 * approved the directory, but will prompt if not. Callers should handle both
 * outcomes gracefully.
 */
export async function ensureHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  // queryPermission / requestPermission are FSAPI extensions not yet in the
  // base TypeScript DOM lib. Declare the shape locally.
  const h = handle as unknown as {
    queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
    requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission(opts)) === 'granted';
}

/**
 * Convenience bootstrap used on editor startup. Loads the stored handle for
 * `appId`, requests permission, and returns the handle on success. Returns
 * null if there is no stored handle or permission was denied.
 */
export async function restoreProjectRoot(
  appId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadProjectRootHandle(appId);
  if (!handle) return null;
  const ok = await ensureHandlePermission(handle);
  return ok ? handle : null;
}
