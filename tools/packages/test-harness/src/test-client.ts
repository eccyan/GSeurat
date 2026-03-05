/**
 * Node.js client for connecting to a tool's test harness WebSocket.
 * Used by test runners to programmatically control and query tool state.
 */
import WebSocket from 'ws';

interface TestResponse {
  id?: string;
  type: 'state' | 'dispatch_result' | 'pong' | 'dom_result' | 'error';
  data?: unknown;
  ok?: boolean;
  message?: string;
}

export class TestClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<
    number,
    { resolve: (resp: TestResponse) => void; reject: (err: Error) => void }
  >();
  private requestCounter = 0;
  private readonly url: string;

  constructor(port: number) {
    this.url = `ws://localhost:${port}`;
  }

  /**
   * Connect to the test harness WebSocket server.
   * Resolves when the connection is open.
   */
  async connect(timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection to ${this.url} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        clearTimeout(timer);
        this.connected = true;
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        // Reject all pending requests
        for (const [, req] of this.pendingRequests) {
          req.reject(new Error('WebSocket closed'));
        }
        this.pendingRequests.clear();
      });

      this.ws.on('message', (raw) => {
        try {
          const resp = JSON.parse(raw.toString()) as TestResponse;
          // Route response to the appropriate pending request
          // Since we don't get back our request ID directly, we use FIFO order
          const firstPending = this.pendingRequests.entries().next().value;
          if (firstPending) {
            const [id, handler] = firstPending;
            this.pendingRequests.delete(id);
            handler.resolve(resp);
          }
        } catch {
          // Ignore parse errors
        }
      });
    });
  }

  /**
   * Disconnect from the test harness.
   */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  /**
   * Send a command and wait for a response.
   */
  private async send(cmd: Record<string, unknown>, timeoutMs = 10000): Promise<TestResponse> {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected');
    }

    const id = ++this.requestCounter;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (resp) => {
          clearTimeout(timer);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws!.send(JSON.stringify(cmd));
    });
  }

  /**
   * Ping the browser to check connectivity.
   */
  async ping(): Promise<boolean> {
    const resp = await this.send({ type: 'ping' });
    return resp.type === 'pong';
  }

  /**
   * Get the full Zustand store state (functions stripped).
   */
  async getState(): Promise<unknown> {
    const resp = await this.send({ type: 'get_state' });
    if (resp.type === 'error') throw new Error(resp.message);
    return resp.data;
  }

  /**
   * Get a specific value from the store using dot-notation path.
   * @example client.getStateSelector('clips') → clips array
   * @example client.getStateSelector('selectedClipId') → string | null
   */
  async getStateSelector(selector: string): Promise<unknown> {
    const resp = await this.send({ type: 'get_state', selector });
    if (resp.type === 'error') throw new Error(resp.message);
    return resp.data;
  }

  /**
   * Dispatch a Zustand store action by name.
   * @example client.dispatch('addClip', 'walk_north')
   * @example client.dispatch('setPlaybackState', 'playing')
   */
  async dispatch(action: string, ...args: unknown[]): Promise<void> {
    const resp = await this.send({ type: 'dispatch', action, args });
    if (resp.type === 'error') throw new Error(resp.message);
  }

  /**
   * Query the DOM for elements matching a CSS selector.
   * Returns an array of { tagName, textContent } objects.
   */
  async queryDom(selector: string): Promise<Array<{ tagName: string; textContent: string }>> {
    const resp = await this.send({ type: 'query_dom', selector });
    if (resp.type === 'error') throw new Error(resp.message);
    return (resp.data as Array<{ tagName: string; textContent: string }>) ?? [];
  }

  /**
   * Wait for the store state to satisfy a condition.
   * Polls every `intervalMs` until the predicate returns true or timeout.
   */
  async waitFor(
    predicate: (state: unknown) => boolean,
    timeoutMs = 5000,
    intervalMs = 100,
  ): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.getState();
      if (predicate(state)) return state;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms`);
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
