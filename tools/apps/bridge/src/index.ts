/**
 * Bridge proxy — relays JSON messages between:
 *   - The Vulkan game engine via /tmp/vulkan_game.sock (Unix domain socket)
 *   - Creative tool clients via ws://localhost:9100 (WebSocket)
 *   - Registered tool apps (e.g. pixel-painter) via WebSocket tool routing
 *
 * Also exposes a REST API on port 9101 for scene / texture file I/O.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { UnixSocketClient } from './unix-client.js';
import { WSServer } from './ws-server.js';
import { RequestTracker } from './request-tracker.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNIX_SOCKET_PATH = '/tmp/vulkan_game.sock';
const WS_PORT = 9100;
const HTTP_PORT = 9101;

// Resolve the engine's assets directory relative to this file's location.
// Project layout: tools/apps/bridge/src/index.ts -> root is 4 levels up.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.resolve(__dirname, '../../../../');
const SCENES_DIR = path.join(ENGINE_DIR, 'assets', 'scenes');
const TEXTURES_DIR = path.join(ENGINE_DIR, 'assets', 'textures');
const CHARACTERS_DIR = path.join(ENGINE_DIR, 'assets', 'characters');

// ---------------------------------------------------------------------------
// Instantiate core components
// ---------------------------------------------------------------------------

const unixClient = new UnixSocketClient(2_000);
const wsServer = new WSServer(WS_PORT);
const tracker = new RequestTracker(30_000);

// ---------------------------------------------------------------------------
// WebSocket message handler — routes to engine or registered tools
// ---------------------------------------------------------------------------

wsServer.onMessage((rawMsg: string, clientId: string) => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawMsg) as Record<string, unknown>;
  } catch {
    console.warn(`[Bridge] Dropping non-JSON message from ${clientId}: ${rawMsg}`);
    return;
  }

  // --- Tool registration ---
  if (parsed['type'] === 'register_tool' && typeof parsed['name'] === 'string') {
    const toolName = parsed['name'] as string;
    wsServer.registerTool(clientId, toolName);
    wsServer.sendTo(clientId, JSON.stringify({ type: 'registered', name: toolName }));
    console.log(`[Bridge] Tool registered: ${toolName} [${clientId}]`);
    return;
  }

  // --- Tool response (from a registered tool back to the requesting client) ---
  // If a tool client sends back a message with _bridge_id, route it like an engine response.
  const bridgeIdFromTool = parsed['_bridge_id'];
  if (typeof bridgeIdFromTool === 'string') {
    const originClientId = tracker.resolve(bridgeIdFromTool);
    delete parsed['_bridge_id'];
    const outgoing = JSON.stringify(parsed);

    if (originClientId) {
      console.log(`[Bridge] Tool->WS [${originClientId}] id=${bridgeIdFromTool} type=${String(parsed['type'] ?? '?')}`);
      const sent = wsServer.sendTo(originClientId, outgoing);
      if (!sent) {
        console.warn(`[Bridge] Origin client gone for id=${bridgeIdFromTool}, broadcasting.`);
        wsServer.broadcast(outgoing);
      }
    } else {
      console.warn(`[Bridge] Unknown _bridge_id=${bridgeIdFromTool} from tool, broadcasting.`);
      wsServer.broadcast(outgoing);
    }
    return;
  }

  // --- Route to a registered tool ---
  const target = parsed['target'] as string | undefined;
  if (target && target !== 'engine') {
    const toolClientId = wsServer.findTool(target);
    if (!toolClientId) {
      wsServer.sendTo(clientId, JSON.stringify({
        type: 'error',
        error: `Tool "${target}" is not connected`,
      }));
      return;
    }

    // Attach correlation ID for response routing
    const bridgeId = randomUUID();
    parsed['_bridge_id'] = bridgeId;
    tracker.track(bridgeId, clientId);

    // Remove the target field before forwarding (tool doesn't need it)
    delete parsed['target'];

    const serialised = JSON.stringify(parsed);
    console.log(`[Bridge] WS->Tool [${target}] id=${bridgeId} cmd=${String(parsed['cmd'] ?? '?')}`);
    wsServer.sendTo(toolClientId, serialised);
    return;
  }

  // --- Default: forward to engine via Unix socket ---
  const bridgeId = randomUUID();
  parsed['_bridge_id'] = bridgeId;
  tracker.track(bridgeId, clientId);

  const serialised = JSON.stringify(parsed);
  console.log(`[Bridge] WS->Unix [${clientId}] id=${bridgeId} cmd=${String(parsed['cmd'] ?? '?')}`);
  unixClient.send(serialised);
});

// ---------------------------------------------------------------------------
// Unix socket -> WebSocket forwarding
// ---------------------------------------------------------------------------

unixClient.onData((line: string) => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    // Raw non-JSON output — broadcast as-is wrapped in a string envelope.
    const envelope = JSON.stringify({ type: 'raw', payload: line });
    wsServer.broadcast(envelope);
    return;
  }

  const bridgeId = parsed['_bridge_id'];

  if (typeof bridgeId === 'string') {
    // This is a response to a request: route back to originating client.
    const clientId = tracker.resolve(bridgeId);

    // Strip the internal field before forwarding.
    delete parsed['_bridge_id'];
    const outgoing = JSON.stringify(parsed);

    if (clientId) {
      console.log(`[Bridge] Unix->WS [${clientId}] id=${bridgeId} type=${String(parsed['type'] ?? '?')}`);
      const sent = wsServer.sendTo(clientId, outgoing);
      if (!sent) {
        // Client disconnected before response arrived; broadcast as fallback.
        console.warn(`[Bridge] Client gone, broadcasting response for id=${bridgeId}`);
        wsServer.broadcast(outgoing);
      }
    } else {
      // ID not found (expired or already resolved) — broadcast.
      console.warn(`[Bridge] Unknown _bridge_id=${bridgeId}, broadcasting.`);
      wsServer.broadcast(outgoing);
    }
  } else {
    // This is an unsolicited event (e.g. dialog_started) — broadcast to all.
    const outgoing = JSON.stringify(parsed);
    console.log(`[Bridge] Unix->WS broadcast event type=${String(parsed['type'] ?? '?')}`);
    wsServer.broadcast(outgoing);
  }
});

unixClient.onClose(() => {
  // Notify all connected tool clients so they can show a reconnecting indicator.
  wsServer.broadcast(JSON.stringify({ type: 'engine_disconnected' }));
});

unixClient.onError((err: Error) => {
  console.error(`[Bridge] Unix socket error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// REST API (file I/O for creative tools)
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '16mb' }));

// Utility: ensure a path stays within the allowed base directory.
function safeResolve(base: string, name: string): string {
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected: ${name}`);
  }
  return resolved;
}

// GET /api/files/scenes/:name — read a scene JSON file
app.get('/api/files/scenes/:name', async (req: Request, res: Response) => {
  try {
    const filePath = safeResolve(SCENES_DIR, `${req.params['name']}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/files/scenes/:name — write a scene JSON file
app.post('/api/files/scenes/:name', async (req: Request, res: Response) => {
  try {
    const filePath = safeResolve(SCENES_DIR, `${req.params['name']}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    await fs.writeFile(filePath, body, 'utf8');
    console.log(`[REST] Scene written: ${filePath}`);
    res.json({ ok: true, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/files/textures/:name — read a texture file as binary
app.get('/api/files/textures/:name', async (req: Request, res: Response) => {
  try {
    const filePath = safeResolve(TEXTURES_DIR, req.params['name']);
    const data = await fs.readFile(filePath);
    // Detect content type from extension.
    const ext = path.extname(req.params['name']).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/files/textures/:name — write a texture PNG (raw binary or base64)
app.post('/api/files/textures/:name', async (req: Request, res: Response) => {
  try {
    const filePath = safeResolve(TEXTURES_DIR, req.params['name']);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    let data: Buffer;
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('application/json') && req.body && typeof req.body['data'] === 'string') {
      // Accept base64-encoded PNG supplied as JSON: { "data": "<base64>" }
      data = Buffer.from(req.body['data'] as string, 'base64');
    } else {
      // Accept raw binary body (application/octet-stream or image/png).
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      data = Buffer.concat(chunks);
    }

    await fs.writeFile(filePath, data);
    console.log(`[REST] Texture written: ${filePath} (${data.length} bytes)`);
    res.json({ ok: true, path: filePath, bytes: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/characters — list all character IDs with manifests
app.get('/api/characters', async (_req: Request, res: Response) => {
  try {
    const entries = await fs.readdir(CHARACTERS_DIR, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mPath = path.join(CHARACTERS_DIR, entry.name, 'manifest.json');
        try {
          await fs.access(mPath);
          ids.push(entry.name);
        } catch {
          // No manifest — skip
        }
      }
    }
    res.json({ characters: ids.sort() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/characters/:id — read a character manifest
app.get('/api/characters/:id', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(CHARACTERS_DIR, req.params['id']!);
    const filePath = path.join(charDir, 'manifest.json');
    const content = await fs.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.send(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/characters/:id — write/update a character manifest
app.post('/api/characters/:id', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(CHARACTERS_DIR, req.params['id']!);
    await fs.mkdir(charDir, { recursive: true });
    const filePath = path.join(charDir, 'manifest.json');
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    await fs.writeFile(filePath, body, 'utf8');
    console.log(`[REST] Character manifest written: ${filePath}`);
    res.json({ ok: true, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/characters/:id/frames/:anim/:frame — get a specific frame's status
app.get('/api/characters/:id/frames/:anim/:frame', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(CHARACTERS_DIR, req.params['id']!);
    const filePath = path.join(charDir, 'manifest.json');
    const content = await fs.readFile(filePath, 'utf8');
    const manifest = JSON.parse(content);
    const anim = manifest.animations?.find((a: { name: string }) => a.name === req.params['anim']);
    if (!anim) {
      res.status(404).json({ error: `Animation "${req.params['anim']}" not found` });
      return;
    }
    const frameIdx = parseInt(req.params['frame']!, 10);
    const frame = anim.frames?.find((f: { index: number }) => f.index === frameIdx);
    if (!frame) {
      res.status(404).json({ error: `Frame ${frameIdx} not found` });
      return;
    }
    res.json(frame);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// POST /api/characters/:id/frames/:anim/:frame — update a frame's status
app.post('/api/characters/:id/frames/:anim/:frame', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(CHARACTERS_DIR, req.params['id']!);
    const filePath = path.join(charDir, 'manifest.json');
    const content = await fs.readFile(filePath, 'utf8');
    const manifest = JSON.parse(content);
    const anim = manifest.animations?.find((a: { name: string }) => a.name === req.params['anim']);
    if (!anim) {
      res.status(404).json({ error: `Animation "${req.params['anim']}" not found` });
      return;
    }
    const frameIdx = parseInt(req.params['frame']!, 10);
    const frame = anim.frames?.find((f: { index: number }) => f.index === frameIdx);
    if (!frame) {
      res.status(404).json({ error: `Frame ${frameIdx} not found` });
      return;
    }

    // Update frame fields from request body
    if (req.body.status) frame.status = req.body.status;
    if (req.body.source) frame.source = req.body.source;
    if (req.body.file) frame.file = req.body.file;
    if (req.body.generation) frame.generation = req.body.generation;
    if (req.body.review) frame.review = req.body.review;
    if (req.body.notes !== undefined) {
      if (!frame.review) frame.review = { reviewer: 'human', notes: '' };
      frame.review.notes = req.body.notes;
    }

    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[REST] Frame updated: ${req.params['id']}/${req.params['anim']}[${frameIdx}]`);
    res.json({ ok: true, frame });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/characters/:id/assemble — trigger atlas assembly
app.post('/api/characters/:id/assemble', async (req: Request, res: Response) => {
  try {
    // Dynamically import the atlas assembler (optional dependency)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (import('@vulkan-game-tools/atlas-assembler' as any) as Promise<any>);
    const validate = req.body?.validate === true;
    const result = await mod.assembleCharacterAtlas(req.params['id']!, { validate });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// GET /api/tools — list registered tool clients
app.get('/api/tools', (_req: Request, res: Response) => {
  res.json({ tools: wsServer.getToolList() });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    engineConnected: unixClient.isConnected,
    wsClients: wsServer.clientCount,
    pendingRequests: tracker.pendingCount,
    tools: wsServer.getToolList(),
  });
});

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

main().catch((err) => {
  console.error('[Bridge] Fatal error:', err);
  process.exit(1);
});
