import type { Command, Response, EngineEvent } from "./types.js";
import { BRIDGE_WS_URL } from "./constants.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * WebSocket client for communicating with the Vulkan game engine via a bridge
 * proxy. Commands are sent as JSON objects with an auto-generated `id` field;
 * responses are matched back to their pending promises by that same `id`.
 * Engine events (no `id` field) are dispatched to registered event handlers.
 */
export class EngineClient {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventHandlers = new Map<string, Set<(data: unknown) => void>>();

  constructor(url: string = BRIDGE_WS_URL) {
    this.url = url;
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  /**
   * Open the WebSocket connection. Resolves when the connection is ready,
   * rejects if the connection fails or is refused.
   */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        resolve();
      });

      ws.addEventListener("error", (event) => {
        reject(new Error(`WebSocket error connecting to ${this.url}: ${String(event)}`));
      });

      ws.addEventListener("close", (event) => {
        this.ws = null;
        // Reject all pending requests that are still waiting.
        for (const [id, req] of this.pending) {
          req.reject(
            new Error(
              `WebSocket closed (code ${event.code}) before response for request id=${id} was received`,
            ),
          );
        }
        this.pending.clear();
      });

      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
    });
  }

  /**
   * Close the WebSocket connection.
   */
  disconnect(): void {
    if (this.ws !== null) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Returns `true` when the underlying WebSocket is in the OPEN state.
   */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Send a command to the engine and wait for the matching response.
   *
   * An integer `id` is automatically appended to the command object. The
   * returned promise resolves with the full response payload (type-asserted to
   * `T`) once a message arrives whose `id` field matches.
   *
   * @example
   * const state = await client.send<StateResponse>({ cmd: "get_state" });
   */
  send<T = Response>(cmd: Partial<Command> & Record<string, unknown>): Promise<T> {
    if (!this.isConnected || this.ws === null) {
      return Promise.reject(new Error("EngineClient is not connected"));
    }

    const id = this.nextId++;
    const message = JSON.stringify({ ...cmd, id });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      try {
        this.ws!.send(message);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Event subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Register a handler for a named engine event.
   *
   * Returns an unsubscribe function — call it to remove the handler.
   *
   * @example
   * const off = client.on("dialog_started", (data) => console.log(data));
   * // later…
   * off();
   */
  on(event: string, handler: (data: unknown) => void): () => void {
    let handlers = this.eventHandlers.get(event);
    if (handlers === undefined) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);

    return () => {
      const set = this.eventHandlers.get(event);
      if (set !== undefined) {
        set.delete(handler);
        if (set.size === 0) {
          this.eventHandlers.delete(event);
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Internal message handling
  // ---------------------------------------------------------------------------

  private handleMessage(raw: unknown): void {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      console.warn("[EngineClient] Received non-JSON message:", raw);
      return;
    }

    // If the message carries an `id` it is a response to a pending request.
    if (typeof parsed["id"] === "number") {
      const id = parsed["id"] as number;
      const pending = this.pending.get(id);
      if (pending !== undefined) {
        this.pending.delete(id);

        if (parsed["type"] === "error") {
          const message =
            typeof parsed["message"] === "string"
              ? parsed["message"]
              : "Unknown engine error";
          pending.reject(new Error(`Engine error: ${message}`));
        } else {
          pending.resolve(parsed);
        }
        return;
      }
    }

    // Messages with an `event` field are engine-initiated notifications.
    if (typeof parsed["event"] === "string") {
      const eventName = parsed["event"] as string;
      const handlers = this.eventHandlers.get(eventName);
      if (handlers !== undefined) {
        for (const handler of handlers) {
          try {
            handler(parsed as unknown as EngineEvent);
          } catch (err) {
            console.error(`[EngineClient] Event handler for "${eventName}" threw:`, err);
          }
        }
      }
      // Also fire wildcard "*" handlers if any are registered.
      const wildcardHandlers = this.eventHandlers.get("*");
      if (wildcardHandlers !== undefined) {
        for (const handler of wildcardHandlers) {
          try {
            handler(parsed as unknown as EngineEvent);
          } catch (err) {
            console.error("[EngineClient] Wildcard event handler threw:", err);
          }
        }
      }
      return;
    }

    console.warn("[EngineClient] Received unrecognised message:", parsed);
  }
}
