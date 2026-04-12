/**
 * Per-resource asynchronous task queue. Guarantees that tasks for the same
 * key execute strictly sequentially (FIFO), while tasks for different keys
 * execute in parallel.
 *
 * Uses a Promise-chain pattern: each new task chains onto the previous
 * task's promise for that key. When the chain is empty, the key is removed
 * from the map to prevent memory leaks.
 */
export class AsyncResourceLock {
  private chains = new Map<string, Promise<void>>();

  /**
   * Queue a task for the given resource key. Returns the task's result.
   * If the task throws, the error propagates to the caller but does NOT
   * block subsequent tasks for the same key.
   */
  async acquire<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();

    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.chains.set(key, next);

    // Wait for previous task to finish (regardless of success/failure)
    await prev;

    try {
      return await task();
    } finally {
      // Clean up if this is still the tail of the chain
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
      resolve();
    }
  }

  /** Number of keys currently held (for testing/diagnostics). */
  get size(): number {
    return this.chains.size;
  }
}
