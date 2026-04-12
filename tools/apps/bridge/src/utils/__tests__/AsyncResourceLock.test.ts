import { describe, it, expect } from 'vitest';
import { AsyncResourceLock } from '../AsyncResourceLock.js';

describe('AsyncResourceLock', () => {
  it('executes a single task and returns its result', async () => {
    const lock = new AsyncResourceLock();
    const result = await lock.acquire('a', async () => 42);
    expect(result).toBe(42);
  });

  it('serializes tasks for the same key', async () => {
    const lock = new AsyncResourceLock();
    const order: number[] = [];

    const t1 = lock.acquire('a', async () => {
      await delay(50);
      order.push(1);
    });
    const t2 = lock.acquire('a', async () => {
      order.push(2);
    });
    const t3 = lock.acquire('a', async () => {
      order.push(3);
    });

    await Promise.all([t1, t2, t3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel execution for different keys', async () => {
    const lock = new AsyncResourceLock();
    const order: string[] = [];

    const t1 = lock.acquire('a', async () => {
      await delay(50);
      order.push('a');
    });
    const t2 = lock.acquire('b', async () => {
      order.push('b');
    });

    await Promise.all([t1, t2]);
    // 'b' should finish before 'a' because it has no delay
    expect(order).toEqual(['b', 'a']);
  });

  it('does not block the queue when a task throws', async () => {
    const lock = new AsyncResourceLock();
    const order: number[] = [];

    const t1 = lock.acquire('a', async () => {
      order.push(1);
      throw new Error('boom');
    }).catch(() => {});

    const t2 = lock.acquire('a', async () => {
      order.push(2);
      return 'ok';
    });

    await t1;
    const result = await t2;
    expect(order).toEqual([1, 2]);
    expect(result).toBe('ok');
  });

  it('cleans up the key when the chain is empty', async () => {
    const lock = new AsyncResourceLock();
    await lock.acquire('a', async () => {});
    expect(lock.size).toBe(0);
  });

  it('propagates the error to the caller', async () => {
    const lock = new AsyncResourceLock();
    await expect(
      lock.acquire('a', async () => { throw new Error('test error'); })
    ).rejects.toThrow('test error');
  });

  it('handles 10 concurrent tasks for the same key without corruption', async () => {
    const lock = new AsyncResourceLock();
    let counter = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      lock.acquire('shared', async () => {
        const current = counter;
        await delay(Math.random() * 10);
        counter = current + 1;
      }),
    );

    await Promise.all(tasks);
    expect(counter).toBe(10);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
