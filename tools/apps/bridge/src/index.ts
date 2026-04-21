/**
 * Bridge proxy — relays JSON messages between:
 *   - The GSeurat engine via /tmp/gseurat.sock (Unix domain socket)
 *   - Creative tool clients via ws://localhost:9100 (WebSocket)
 *   - Registered tool apps (e.g. pixel-painter) via WebSocket tool routing
 *
 * Also exposes a REST API on port 9101 for scene / texture file I/O.
 */

import express, { type Express } from 'express';

import { UnixSocketClient } from './unix-client.js';
import { WSServer } from './ws-server.js';
import { RequestTracker } from './request-tracker.js';
import { ProjectContext } from './context.js';
import { setupRouter } from './router.js';
import { registerFileRoutes } from './routes/files.js';
import { registerCharacterRoutes } from './routes/characters.js';
import { registerProjectRoutes } from './routes/projects.js';
import {
  startBridgeForTesting as _startBridgeForTesting,
  getTestPort,
  stopBridgeForTesting as _stopBridgeForTesting,
} from './testing.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNIX_SOCKET_PATH = '/tmp/gseurat.sock';
const WS_PORT = 9100;
const HTTP_PORT = 9101;

// ---------------------------------------------------------------------------
// Core instances
// ---------------------------------------------------------------------------

const ctx = new ProjectContext();
const unixClient = new UnixSocketClient(2_000);
const wsServer = new WSServer(WS_PORT);
const tracker = new RequestTracker(30_000);

// ---------------------------------------------------------------------------
// Wire up WS/Unix router — returns forwardToEngine
// ---------------------------------------------------------------------------

const { forwardToEngine } = setupRouter(wsServer, unixClient, tracker, ctx);

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

export const app: Express = express();

// CORS — allow requests from any localhost dev server
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '16mb' }));

// ---------------------------------------------------------------------------
// Register route modules
// ---------------------------------------------------------------------------

registerFileRoutes(app, ctx);
registerCharacterRoutes(app, ctx);
registerProjectRoutes(app, ctx, forwardToEngine, wsServer, unixClient, tracker);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[Bridge] Starting up ...');

  // Start the WebSocket server (non-blocking).
  wsServer.start();

  // Attempt initial connection to the game engine.
  // Failure is non-fatal — UnixSocketClient will keep retrying.
  try {
    await unixClient.connect(UNIX_SOCKET_PATH);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Bridge] Initial engine connection failed (${message}), will retry.`);
  }

  // Start REST API server.
  app.listen(HTTP_PORT, () => {
    console.log(`[Bridge] REST API listening on http://localhost:${HTTP_PORT}`);
  });

  console.log('[Bridge] Ready.');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[Bridge] Received ${signal}, shutting down ...`);
  tracker.destroy();
  unixClient.disconnect();
  await wsServer.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('[Bridge] Fatal error:', err);
    process.exit(1);
  });
}

// ---------------------------------------------------------------------------
// Public exports (test helpers + runtime accessor)
// ---------------------------------------------------------------------------

export async function startBridgeForTesting(opts: { port: number }): Promise<void> {
  return _startBridgeForTesting(app, opts);
}

export { getTestPort };

export async function stopBridgeForTesting(): Promise<void> {
  return _stopBridgeForTesting(ctx);
}

export function getActiveProjectDir(): string | null {
  return ctx.activeProjectDir;
}
