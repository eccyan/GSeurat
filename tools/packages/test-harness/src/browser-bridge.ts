/**
 * Browser-side bridge script injected by the Vite plugin.
 * Connects back to the test harness WS server and handles commands.
 */

interface TestCommand {
  id?: string;
  type: 'get_state' | 'get_state_selector' | 'dispatch' | 'ping' | 'query_dom';
  selector?: string;
  action?: string;
  args?: unknown[];
}

interface TestResponse {
  id?: string;
  type: 'state' | 'dispatch_result' | 'pong' | 'dom_result' | 'error';
  data?: unknown;
  ok?: boolean;
  message?: string;
}

export function initBrowserBridge(port: number): void {
  const url = `ws://localhost:${port}`;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log(`[test-harness] Connected to test server on port ${port}`);
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws?.close();
    };

    ws.onmessage = (event) => {
      try {
        const cmd = JSON.parse(event.data as string) as TestCommand;
        const response = handleCommand(cmd);
        ws?.send(JSON.stringify(response));
      } catch (err) {
        const errResp: TestResponse = {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
        ws?.send(JSON.stringify(errResp));
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  function handleCommand(cmd: TestCommand): TestResponse {
    const id = cmd.id;
    const store = window.__ZUSTAND_STORE__;

    switch (cmd.type) {
      case 'ping':
        return { id, type: 'pong' };

      case 'get_state': {
        if (!store) return { id, type: 'error', message: 'No store registered' };
        const state = store.getState();
        // If a selector path is provided, drill into the state
        if (cmd.selector) {
          const value = getNestedValue(state as Record<string, unknown>, cmd.selector);
          return { id, type: 'state', data: serializeState(value) };
        }
        return { id, type: 'state', data: serializeState(state) };
      }

      case 'get_state_selector': {
        if (!store) return { id, type: 'error', message: 'No store registered' };
        if (!cmd.selector) return { id, type: 'error', message: 'Missing selector' };
        const state = store.getState();
        const value = getNestedValue(state as Record<string, unknown>, cmd.selector);
        return { id, type: 'state', data: serializeState(value) };
      }

      case 'dispatch': {
        if (!store) return { id, type: 'error', message: 'No store registered' };
        if (!cmd.action) return { id, type: 'error', message: 'Missing action name' };
        const state = store.getState() as Record<string, unknown>;
        const fn = state[cmd.action];
        if (typeof fn !== 'function') {
          return { id, type: 'error', message: `Action "${cmd.action}" is not a function` };
        }
        try {
          fn(...(cmd.args ?? []));
          return { id, type: 'dispatch_result', ok: true };
        } catch (err) {
          return {
            id,
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }

      case 'query_dom': {
        if (!cmd.selector) return { id, type: 'error', message: 'Missing DOM selector' };
        const elements = document.querySelectorAll(cmd.selector);
        const results = Array.from(elements).map((el) => ({
          tagName: el.tagName,
          textContent: el.textContent?.trim() ?? '',
          innerHTML: el.innerHTML.slice(0, 500),
        }));
        return { id, type: 'dom_result', data: results };
      }

      default:
        return { id, type: 'error', message: `Unknown command type: ${cmd.type}` };
    }
  }

  connect();
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function serializeState(state: unknown): unknown {
  // Strip functions from state for JSON serialization
  if (state === null || state === undefined) return state;
  if (typeof state !== 'object') return state;
  if (Array.isArray(state)) return state.map(serializeState);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (typeof value === 'function') continue;
    result[key] = serializeState(value);
  }
  return result;
}
