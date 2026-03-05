/**
 * Vite plugin that starts a WebSocket server for test control.
 * In dev mode, it injects the browser bridge script that connects back.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';

export interface TestHarnessPluginOptions {
  /** Port for the test WebSocket server (default: devPort + 1000) */
  port: number;
}

export function testHarnessPlugin(options: TestHarnessPluginOptions): Plugin {
  const { port } = options;
  let wss: WebSocketServer | null = null;
  let browserSocket: WebSocket | null = null;

  // Map of pending requests from test clients waiting for browser responses
  const pendingRequests = new Map<
    string,
    { resolve: (data: string) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  let requestCounter = 0;

  return {
    name: 'test-harness',
    apply: 'serve', // Only in dev mode

    configureServer(server: ViteDevServer) {
      wss = new WebSocketServer({ port });

      wss.on('connection', (ws) => {
        // Determine if this is the browser client or a test runner client
        // The browser sends a special "register" message first
        let isBrowser = false;

        ws.on('message', (raw) => {
          const msg = raw.toString();

          try {
            const parsed = JSON.parse(msg);

            if (parsed.type === '__bridge_register__') {
              // This is the browser bridge
              isBrowser = true;
              browserSocket = ws;
              return;
            }

            if (isBrowser) {
              // Response from browser → route to pending test client request
              const id = parsed.id;
              if (id && pendingRequests.has(id)) {
                const req = pendingRequests.get(id)!;
                clearTimeout(req.timeout);
                pendingRequests.delete(id);
                req.resolve(msg);
              }
              return;
            }

            // This is a test runner client sending commands
            const id = `req_${++requestCounter}`;
            parsed.id = id;

            if (!browserSocket || browserSocket.readyState !== WebSocket.OPEN) {
              ws.send(JSON.stringify({ id, type: 'error', message: 'No browser connected' }));
              return;
            }

            // Forward to browser, wait for response
            const promise = new Promise<string>((resolve) => {
              const timeout = setTimeout(() => {
                pendingRequests.delete(id);
                resolve(JSON.stringify({ id, type: 'error', message: 'Request timed out' }));
              }, 10000);
              pendingRequests.set(id, { resolve, timeout });
            });

            browserSocket.send(JSON.stringify(parsed));

            promise.then((response) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(response);
              }
            });
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
            }));
          }
        });

        ws.on('close', () => {
          if (isBrowser && browserSocket === ws) {
            browserSocket = null;
          }
        });
      });

      wss.on('error', (err) => {
        console.error(`[test-harness] WebSocket server error on port ${port}:`, err.message);
      });

      // Clean up on Vite server close
      server.httpServer?.on('close', () => {
        for (const [, req] of pendingRequests) {
          clearTimeout(req.timeout);
        }
        pendingRequests.clear();
        wss?.close();
        wss = null;
      });

      console.log(`[test-harness] Test control socket listening on ws://localhost:${port}`);
    },

    transformIndexHtml() {
      // Inject the browser bridge script
      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: `
// Connect to test harness and register as browser client
console.log('[test-harness] Browser bridge connecting to ws://localhost:${port}...');
const ws = new WebSocket('ws://localhost:${port}');
ws.onopen = () => {
  console.log('[test-harness] Browser bridge connected, registering...');
  ws.send(JSON.stringify({ type: '__bridge_register__' }));
};
ws.onmessage = (event) => {
  try {
    const cmd = JSON.parse(event.data);
    const store = window.__ZUSTAND_STORE__;
    let response;

    switch (cmd.type) {
      case 'ping':
        response = { id: cmd.id, type: 'pong' };
        break;
      case 'get_state': {
        if (!store) { response = { id: cmd.id, type: 'error', message: 'No store registered' }; break; }
        const state = store.getState();
        const data = cmd.selector ? getNestedValue(state, cmd.selector) : state;
        response = { id: cmd.id, type: 'state', data: serializeState(data) };
        break;
      }
      case 'get_state_selector': {
        if (!store) { response = { id: cmd.id, type: 'error', message: 'No store registered' }; break; }
        const val = getNestedValue(store.getState(), cmd.selector);
        response = { id: cmd.id, type: 'state', data: serializeState(val) };
        break;
      }
      case 'dispatch': {
        if (!store) { response = { id: cmd.id, type: 'error', message: 'No store registered' }; break; }
        const s = store.getState();
        const fn = s[cmd.action];
        if (typeof fn !== 'function') {
          response = { id: cmd.id, type: 'error', message: 'Action "' + cmd.action + '" is not a function' };
          break;
        }
        try { fn(...(cmd.args || [])); response = { id: cmd.id, type: 'dispatch_result', ok: true }; }
        catch (e) { response = { id: cmd.id, type: 'error', message: String(e) }; }
        break;
      }
      case 'query_dom': {
        const els = document.querySelectorAll(cmd.selector || '*');
        const results = Array.from(els).map(el => ({ tagName: el.tagName, textContent: (el.textContent || '').trim().slice(0, 200) }));
        response = { id: cmd.id, type: 'dom_result', data: results };
        break;
      }
      default:
        response = { id: cmd.id, type: 'error', message: 'Unknown: ' + cmd.type };
    }
    ws.send(JSON.stringify(response));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', message: String(e) }));
  }
};
ws.onclose = () => setTimeout(() => location.reload(), 3000);

function getNestedValue(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => o != null ? o[k] : undefined, obj);
}
function serializeState(state) {
  if (state == null || typeof state !== 'object') return state;
  if (Array.isArray(state)) return state.map(serializeState);
  const r = {};
  for (const [k, v] of Object.entries(state)) { if (typeof v !== 'function') r[k] = serializeState(v); }
  return r;
}
          `,
          injectTo: 'body',
        },
      ];
    },
  };
}
