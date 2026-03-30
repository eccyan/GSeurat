/**
 * RequestTracker correlates _bridge_id values to the WebSocket client
 * that originated the request, so responses can be routed back to the
 * correct client instead of being broadcast to everyone.
 */

interface TrackedRequest {
  clientId: string;
  originalId: unknown;  // client's original `id` field (number, string, or undefined)
  expiresAt: number;
}

export class RequestTracker {
  private readonly pending = new Map<string, TrackedRequest>();
  private readonly timeoutMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
    // Run stale-entry cleanup every 10 seconds.
    this.cleanupTimer = setInterval(() => this.cleanup(), 10_000);
    // Allow Node.js to exit even if the interval is still running.
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Record that bridgeId was sent by clientId, preserving the client's
   * original `id` field so it can be reattached to the response.
   */
  track(bridgeId: string, clientId: string, originalId?: unknown): void {
    this.pending.set(bridgeId, {
      clientId,
      originalId,
      expiresAt: Date.now() + this.timeoutMs,
    });
  }

  /**
   * Look up which clientId originated bridgeId, then remove the entry.
   * Returns undefined if not found or already expired.
   */
  resolve(bridgeId: string): { clientId: string; originalId: unknown } | undefined {
    const entry = this.pending.get(bridgeId);
    if (!entry) return undefined;
    this.pending.delete(bridgeId);
    if (Date.now() > entry.expiresAt) return undefined;
    return { clientId: entry.clientId, originalId: entry.originalId };
  }

  /**
   * Remove all entries that have passed their TTL.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.pending) {
      if (now > entry.expiresAt) {
        console.log(`[RequestTracker] Expiring stale request: ${id}`);
        this.pending.delete(id);
      }
    }
  }

  /**
   * Stop the cleanup interval (call on shutdown).
   */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
