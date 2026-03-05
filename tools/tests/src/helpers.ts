/**
 * Shared scenario test helpers — reusable setup/assertion utilities
 * for multi-step workflow tests.
 */
import { TestClient } from '@vulkan-game-tools/test-harness/client';
import { assert } from './qa-runner.js';

/**
 * Assert that a state selector satisfies a predicate.
 */
export async function assertStateHas<T>(
  client: TestClient,
  selector: string,
  predicate: (value: T) => boolean,
  label: string,
): Promise<T> {
  const value = (await client.getStateSelector(selector)) as T;
  assert(predicate(value), label);
  return value;
}

/**
 * Dispatch an action then verify a state selector satisfies a predicate.
 */
export async function dispatchAndVerify<T>(
  client: TestClient,
  action: string,
  args: unknown[],
  selector: string,
  predicate: (value: T) => boolean,
  label: string,
): Promise<T> {
  await client.dispatch(action, ...args);
  return assertStateHas<T>(client, selector, predicate, label);
}

/**
 * Dispatch the same action `count` times with args produced by a factory.
 */
export async function repeatDispatch(
  client: TestClient,
  action: string,
  argsFactory: (i: number) => unknown[],
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await client.dispatch(action, ...argsFactory(i));
  }
}

/**
 * Undo `times` steps.
 */
export async function undoTimes(
  client: TestClient,
  times: number,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await client.dispatch('undo');
  }
}

/**
 * Redo `times` steps.
 */
export async function redoTimes(
  client: TestClient,
  times: number,
): Promise<void> {
  for (let i = 0; i < times; i++) {
    await client.dispatch('redo');
  }
}
