/**
 * Persistent bridge WebSocket connection with auto-reconnect.
 *
 * Provides a fire-and-forget sendBridgeCommand() and sequential
 * sendBridgeCommands() for tools that push data to Staging via bridge.
 * Replaces the old pattern of creating a new WebSocket per command.
 */

import { EngineClient } from './client.js';
import { BRIDGE_WS_URL } from './constants.js';
const RECONNECT_INTERVAL = 3000; // ms

let client: EngineClient | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connecting = false;
let wasConnected = false;
let reconnectCallback: (() => void) | null = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureConnected();
  }, RECONNECT_INTERVAL);
}

async function ensureConnected(): Promise<EngineClient | null> {
  if (client?.isConnected) return client;
  if (connecting) return null;

  connecting = true;
  try {
    if (!client) {
      client = new EngineClient(BRIDGE_WS_URL);
    }
    await client.connect();
    connecting = false;
    // Fire reconnect callback if this is a reconnection (not the first connect)
    if (wasConnected && reconnectCallback) {
      reconnectCallback();
    }
    wasConnected = true;
    return client;
  } catch {
    connecting = false;
    scheduleReconnect();
    return null;
  }
}

/**
 * Send a command to the bridge. Fire-and-forget: silently drops if not connected.
 * Attempts to reconnect in the background if disconnected.
 */
export async function sendBridgeCommand(payload: Record<string, unknown>): Promise<void> {
  const c = await ensureConnected();
  if (!c) return;
  try {
    await c.send(payload);
  } catch {
    scheduleReconnect();
  }
}

/**
 * Send multiple commands sequentially to the bridge.
 * Each command waits for acknowledgement before sending the next.
 */
export async function sendBridgeCommands(payloads: Record<string, unknown>[]): Promise<void> {
  const c = await ensureConnected();
  if (!c) return;
  try {
    for (const payload of payloads) {
      await c.send(payload);
    }
  } catch {
    scheduleReconnect();
  }
}

/**
 * Get the underlying EngineClient (for event subscriptions etc.).
 * May return null if not yet connected.
 */
export function getBridgeClient(): EngineClient | null {
  return client?.isConnected ? client : null;
}

/**
 * Register a callback that fires when the bridge reconnects after a disconnect.
 * Does NOT fire on the initial connection — only on subsequent reconnections.
 */
export function onBridgeReconnect(cb: () => void): void {
  reconnectCallback = cb;
}

/**
 * Disconnect and stop reconnecting.
 */
export function disconnectBridge(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (client) {
    client.disconnect();
    client = null;
  }
}
