/**
 * Thin client wrapper around `POST /api/project/root` on the Bridge.
 *
 * Used by both:
 *   - the File menu's "Connect Bridge to Project Root…" handler
 *   - the App.tsx bootstrap that auto-applies a cached path on reload
 *
 * Phase 0.1 #2.
 */

const BRIDGE_REST_URL = 'http://localhost:9101';

export type ConnectBridgeResult =
  | { ok: true; activeProjectDir: string }
  | { ok: false; error: string };

/**
 * POST the absolute path to the bridge so the engine's `set_project_root`
 * can resolve relative asset paths. Returns a discriminated union — never
 * throws on protocol-level failures so callers can react with toast / log.
 */
export async function connectBridgeToPath(
  absolutePath: string,
): Promise<ConnectBridgeResult> {
  if (!absolutePath) {
    return { ok: false, error: 'absolutePath is empty' };
  }
  try {
    const res = await fetch(`${BRIDGE_REST_URL}/api/project/root`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: absolutePath }),
    });
    if (res.ok) {
      const body = (await res.json()) as { activeProjectDir?: string };
      return {
        ok: true,
        activeProjectDir: body.activeProjectDir ?? absolutePath,
      };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? res.statusText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Network error (fetch failed) usually means the bridge server isn't running
    if (msg === 'Failed to fetch' || msg.includes('ECONNREFUSED')) {
      return {
        ok: false,
        error: `Bridge server is not running.\n\nStart it with:\n  cd tools && pnpm --filter bridge dev`,
      };
    }
    return { ok: false, error: msg };
  }
}
