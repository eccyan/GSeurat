import net from 'node:net';
import { EventEmitter } from 'node:events';

type DataHandler = (line: string) => void;
type CloseHandler = () => void;
type ErrorHandler = (err: Error) => void;

/**
 * UnixSocketClient maintains a persistent connection to the game engine's
 * Unix domain socket.  It emits complete JSON lines and handles automatic
 * reconnection when the connection is lost.
 */
export class UnixSocketClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private socketPath = '';
  private lineBuffer = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelayMs: number;
  private destroyed = false;

  constructor(reconnectDelayMs = 2_000) {
    super();
    this.reconnectDelayMs = reconnectDelayMs;
  }

  /**
   * Establish a connection to the Unix socket at `path`.
   * Resolves once the socket is connected.
   */
  connect(path: string): Promise<void> {
    this.socketPath = path;
    this.destroyed = false;
    return new Promise<void>((resolve, reject) => {
      this.createSocket(resolve, reject);
    });
  }

  /**
   * Send a raw string to the engine.  A newline delimiter is appended
   * automatically if not already present.
   */
  send(data: string): void {
    if (!this.socket || this.socket.destroyed) {
      console.warn('[UnixClient] Cannot send — not connected.');
      return;
    }
    const payload = data.endsWith('\n') ? data : `${data}\n`;
    this.socket.write(payload);
  }

  /**
   * Register a handler for complete JSON lines received from the engine.
   */
  onData(handler: DataHandler): void {
    this.on('data', handler);
  }

  /**
   * Register a handler for (re)connection events.
   */
  onConnect(handler: () => void): void {
    this.on('connect', handler);
  }

  /**
   * Register a handler for connection-close events.
   */
  onClose(handler: CloseHandler): void {
    this.on('close', handler);
  }

  /**
   * Register a handler for socket errors.
   */
  onError(handler: ErrorHandler): void {
    this.on('error', handler);
  }

  /**
   * Permanently close the connection and disable reconnection.
   */
  disconnect(): void {
    this.destroyed = true;
    this.cancelReconnect();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /** True when a live socket exists. */
  get isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createSocket(
    onConnect?: () => void,
    onConnectError?: (err: Error) => void,
  ): void {
    if (this.destroyed) return;

    const sock = net.createConnection({ path: this.socketPath });
    this.socket = sock;
    let connectSettled = false;

    sock.setEncoding('utf8');

    sock.once('connect', () => {
      connectSettled = true;
      console.log(`[UnixClient] Connected to ${this.socketPath}`);
      this.emit('connect');
      onConnect?.();
    });

    sock.on('data', (chunk: string) => {
      this.lineBuffer += chunk;
      const lines = this.lineBuffer.split('\n');
      // The last element is either empty (trailing newline) or a partial line.
      this.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          this.emit('data', trimmed);
        }
      }
    });

    sock.on('close', () => {
      console.log('[UnixClient] Connection closed.');
      this.socket = null;
      this.emit('close');
      this.scheduleReconnect();
    });

    sock.on('error', (err: Error) => {
      console.error(`[UnixClient] Socket error: ${err.message}`);
      this.emit('error', err);
      if (!connectSettled) {
        connectSettled = true;
        onConnectError?.(err);
      }
      // The 'close' event fires after 'error', so reconnect logic lives there.
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.cancelReconnect();
    console.log(
      `[UnixClient] Reconnecting in ${this.reconnectDelayMs}ms …`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createSocket();
    }, this.reconnectDelayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
