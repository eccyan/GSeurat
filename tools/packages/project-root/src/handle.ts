import { get, set, del } from 'idb-keyval';

const KEY_PREFIX = 'gseurat:project-root-handle:';
const BRIDGE_PATH_KEY_PREFIX = 'gseurat:bridge-project-path:';

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

/**
 * Persistent record of "the last absolute disk path the user typed when
 * connecting the bridge for this project handle." The File System Access
 * API hides the absolute path from JavaScript, so we cannot derive this — it
 * has to be remembered between sessions.
 *
 * The pairing is keyed by `handleName` (the directory's basename) so a
 * cached entry is only auto-applied when the user re-opens the *same*
 * directory in a new session. Two unrelated projects that happen to share a
 * basename will collide; we accept that risk for the convenience of skipping
 * the manual prompt.
 */
export interface BridgePathRecord {
  /** `FileSystemDirectoryHandle.name` at the time of persistence. */
  handleName: string;
  /** Absolute disk path the user typed in the Connect Bridge prompt. */
  absolutePath: string;
}

/**
 * Pure check used by the auto-fill bootstrap: returns the stored absolute
 * path iff the cached record's handle name matches the currently restored
 * handle name. Extracted so it can be unit-tested without IDB.
 */
export function matchBridgePath(
  record: BridgePathRecord | null,
  handleName: string,
): string | null {
  if (!record) return null;
  if (record.handleName !== handleName) return null;
  if (!record.absolutePath) return null;
  return record.absolutePath;
}

/**
 * Persist a `{handleName, absolutePath}` pair so future sessions can skip
 * the manual Connect Bridge prompt for this project. `appId` scopes the
 * record per editor.
 */
export async function saveBridgePath(
  appId: string,
  record: BridgePathRecord,
): Promise<void> {
  await set(BRIDGE_PATH_KEY_PREFIX + appId, record);
}

/**
 * Load a previously stored bridge path record. Returns null if none is
 * stored.
 */
export async function loadBridgePath(
  appId: string,
): Promise<BridgePathRecord | null> {
  const record = await get<BridgePathRecord>(BRIDGE_PATH_KEY_PREFIX + appId);
  return record ?? null;
}

/** Remove a stored bridge path record for this `appId`. */
export async function clearBridgePath(appId: string): Promise<void> {
  await del(BRIDGE_PATH_KEY_PREFIX + appId);
}
