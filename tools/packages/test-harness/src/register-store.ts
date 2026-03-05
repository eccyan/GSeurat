/**
 * Registers a Zustand store on `window` so the browser bridge can read/dispatch.
 * Call this in your app's main.tsx (dev-only).
 */

declare global {
  interface Window {
    __ZUSTAND_STORE__?: {
      getState: () => unknown;
      setState: (partial: Record<string, unknown>) => void;
      subscribe: (listener: (state: unknown) => void) => () => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }
}

export function registerTestStore(store: {
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
  subscribe: (listener: (state: unknown) => void) => () => void;
}): void {
  if (typeof window !== 'undefined') {
    window.__ZUSTAND_STORE__ = store;
  }
}
