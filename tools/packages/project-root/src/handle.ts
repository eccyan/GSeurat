import { get, set, del } from 'idb-keyval';

const KEY_PREFIX = 'gseurat:project-root-handle:';

// FSAPI permission methods are not yet in the base TypeScript DOM lib.
// Declare the minimal shape we use so ensureHandlePermission can be typed
// without an inline cast.
interface FSHandleWithPermission {
  queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

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
 *
 * Throws if IndexedDB is unavailable (private browsing, storage disabled) or
 * the quota is exceeded. Callers should catch and surface a user-visible error.
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
 * If the user previously denied permission for this directory, most browsers
 * will not prompt again and requestPermission() will return 'denied'
 * immediately — this function returns false in that case rather than throwing.
 * Callers should handle the false return by prompting the user to re-pick the
 * directory via showDirectoryPicker().
 */
export async function ensureHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  const h = handle as unknown as FSHandleWithPermission;
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission(opts)) === 'granted';
}

/**
 * Convenience bootstrap used on editor startup. Loads the stored handle for
 * `appId`, re-acquires read/write permission if needed, and returns the handle
 * on success. Returns null if there is no stored handle or permission was
 * denied.
 */
export async function restoreProjectRoot(
  appId: string,
): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadProjectRootHandle(appId);
  if (!handle) return null;
  const ok = await ensureHandlePermission(handle);
  return ok ? handle : null;
}
