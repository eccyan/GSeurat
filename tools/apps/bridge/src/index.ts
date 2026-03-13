/**
 * Bridge proxy — relays JSON messages between:
 *   - The Vulkan game engine via /tmp/vulkan_game.sock (Unix domain socket)
 *   - Creative tool clients via ws://localhost:9100 (WebSocket)
 *   - Registered tool apps (e.g. pixel-painter) via WebSocket tool routing
 *
 * Also exposes a REST API on port 9101 for scene / texture file I/O.
 */

import path from 'node:path';
import os from 'node:os';
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
// Project context — mutable active project directory
// ---------------------------------------------------------------------------

let activeProjectDir: string | null = null;

function getCharactersDir(): string {
  return activeProjectDir
    ? path.join(activeProjectDir, 'characters')
    : CHARACTERS_DIR;
}

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
    const charsDir = getCharactersDir();
    const entries = await fs.readdir(charsDir, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const mPath = path.join(charsDir, entry.name, 'manifest.json');
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
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
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
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
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

// POST /api/characters/:id/rename — rename a character (change its ID)
app.post('/api/characters/:id/rename', async (req: Request, res: Response) => {
  try {
    const oldId = req.params['id']!;
    const { newId } = req.body as { newId: string };
    if (!newId || !newId.match(/^[a-z0-9_]+$/)) {
      res.status(400).json({ error: 'newId must be lowercase alphanumeric with underscores' });
      return;
    }
    const charsDir = getCharactersDir();
    const oldDir = safeResolve(charsDir, oldId);
    const newDir = safeResolve(charsDir, newId);

    // Check old exists
    try { await fs.access(oldDir); } catch {
      res.status(404).json({ error: `Character "${oldId}" not found` });
      return;
    }
    // Check new doesn't exist
    try { await fs.access(newDir); res.status(409).json({ error: `Character "${newId}" already exists` }); return; } catch { /* good */ }

    // Rename directory
    await fs.rename(oldDir, newDir);

    // Update character_id in manifest
    const manifestPath = path.join(newDir, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      manifest.character_id = newId;
      if (manifest.display_name === oldId) manifest.display_name = newId;
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch { /* manifest update optional */ }

    console.log(`[REST] Character renamed: ${oldId} → ${newId}`);
    res.json({ ok: true, oldId, newId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Allowed concept/chibi view directions
const VALID_VIEWS = ['front', 'back', 'right', 'left'];

// Helper: read binary from request (JSON base64 or raw)
async function readBinaryBody(req: Request): Promise<Buffer> {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('application/json') && req.body && typeof req.body['data'] === 'string') {
    return Buffer.from(req.body['data'] as string, 'base64');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}

// POST /api/characters/:id/concept-image/:view? — save concept art image
// When :view is provided (front|back|right|left) → saves concept_{view}.png
// When :view is omitted → saves concept.png
app.post('/api/characters/:id/concept-image/:view', saveConceptImageHandler);
app.post('/api/characters/:id/concept-image', saveConceptImageHandler);

async function saveConceptImageHandler(req: Request, res: Response) {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const view = req.params['view'];
    if (view && !VALID_VIEWS.includes(view)) {
      res.status(400).json({ error: `Invalid view: ${view}` });
      return;
    }
    await fs.mkdir(charDir, { recursive: true });
    const filename = view ? `concept_${view}.png` : 'concept.png';
    const filePath = path.join(charDir, filename);
    const data = await readBinaryBody(req);

    await fs.writeFile(filePath, data);
    console.log(`[REST] Concept image${view ? ` (${view})` : ''} written: ${filePath} (${data.length} bytes)`);
    res.json({ ok: true, path: filePath, bytes: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
}

// GET /api/characters/:id/concept-image/:view? — serve concept art image
// When :view is provided → serves concept_{view}.png
// When :view is omitted → serves concept.png with fallback to concept_front.png
app.get('/api/characters/:id/concept-image/:view', serveConceptImageHandler);
app.get('/api/characters/:id/concept-image', serveConceptImageHandler);

async function serveConceptImageHandler(req: Request, res: Response) {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const view = req.params['view'];
    if (view && !VALID_VIEWS.includes(view)) {
      res.status(400).json({ error: `Invalid view: ${view}` });
      return;
    }

    let data: Buffer | null = null;
    if (view) {
      data = await fs.readFile(path.join(charDir, `concept_${view}.png`));
    } else {
      // Backward compat: try concept.png first, then concept_front.png
      for (const filename of ['concept.png', 'concept_front.png']) {
        try {
          data = await fs.readFile(path.join(charDir, filename));
          break;
        } catch { /* try next */ }
      }
    }
    if (!data) throw new Error('No concept image found');
    res.setHeader('Content-Type', 'image/png');
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
}

// POST /api/characters/:id/chibi-image/:view? — save chibi art image
app.post('/api/characters/:id/chibi-image/:view', saveChibiImageHandler);
app.post('/api/characters/:id/chibi-image', saveChibiImageHandler);

async function saveChibiImageHandler(req: Request, res: Response) {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const view = req.params['view'];
    if (view && !VALID_VIEWS.includes(view)) {
      res.status(400).json({ error: `Invalid view: ${view}` });
      return;
    }
    await fs.mkdir(charDir, { recursive: true });
    const filename = view ? `chibi_${view}.png` : 'chibi.png';
    const filePath = path.join(charDir, filename);
    const data = await readBinaryBody(req);

    await fs.writeFile(filePath, data);
    console.log(`[REST] Chibi image${view ? ` (${view})` : ''} written: ${filePath} (${data.length} bytes)`);
    res.json({ ok: true, path: filePath, bytes: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
}

// GET /api/characters/:id/chibi-image/:view? — serve chibi art image
app.get('/api/characters/:id/chibi-image/:view', serveChibiImageHandler);
app.get('/api/characters/:id/chibi-image', serveChibiImageHandler);

async function serveChibiImageHandler(req: Request, res: Response) {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const view = req.params['view'];
    if (view && !VALID_VIEWS.includes(view)) {
      res.status(400).json({ error: `Invalid view: ${view}` });
      return;
    }

    let data: Buffer | null = null;
    if (view) {
      data = await fs.readFile(path.join(charDir, `chibi_${view}.png`));
    } else {
      for (const filename of ['chibi.png', 'chibi_front.png']) {
        try {
          data = await fs.readFile(path.join(charDir, filename));
          break;
        } catch { /* try next */ }
      }
    }
    if (!data) throw new Error('No chibi image found');
    res.setHeader('Content-Type', 'image/png');
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
}

// POST /api/characters/:id/pixel-image — save pixel art image (base64 PNG)
app.post('/api/characters/:id/pixel-image', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    await fs.mkdir(charDir, { recursive: true });
    const filePath = path.join(charDir, 'pixel.png');

    let data: Buffer;
    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('application/json') && req.body && typeof req.body['data'] === 'string') {
      data = Buffer.from(req.body['data'] as string, 'base64');
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      data = Buffer.concat(chunks);
    }

    await fs.writeFile(filePath, data);
    console.log(`[REST] Pixel image written: ${filePath} (${data.length} bytes)`);
    res.json({ ok: true, path: filePath, bytes: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/characters/:id/pixel-image — serve pixel art image
app.get('/api/characters/:id/pixel-image', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const filePath = path.join(charDir, 'pixel.png');
    const data = await fs.readFile(filePath);
    res.setHeader('Content-Type', 'image/png');
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 404;
    res.status(statusCode).json({ error: message });
  }
});

// POST /api/characters/:id/frames/:anim/:frame/image — save a frame PNG
app.post('/api/characters/:id/frames/:anim/:frame/image', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const animDir = path.join(charDir, req.params['anim']!);
    await fs.mkdir(animDir, { recursive: true });
    const filename = `${req.params['anim']}_${req.params['frame']}.png`;
    const filePath = path.join(animDir, filename);

    let data: Buffer;
    const contentType = req.headers['content-type'] ?? '';
    if (contentType.includes('application/json') && req.body && typeof req.body['data'] === 'string') {
      data = Buffer.from(req.body['data'] as string, 'base64');
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      data = Buffer.concat(chunks);
    }

    await fs.writeFile(filePath, data);
    console.log(`[REST] Frame image written: ${filePath} (${data.length} bytes)`);

    // Also update the manifest frame entry with the file path
    const manifestPath = path.join(charDir, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const anim = manifest.animations?.find((a: { name: string }) => a.name === req.params['anim']);
      const frameIdx = parseInt(req.params['frame']!, 10);
      const frame = anim?.frames?.find((f: { index: number }) => f.index === frameIdx);
      if (frame) {
        frame.file = `${req.params['anim']}/${filename}`;
        if (frame.status === 'pending') frame.status = 'generated';
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      }
    } catch { /* manifest update optional */ }

    res.json({ ok: true, path: filePath, bytes: data.length, file: `${req.params['anim']}/${filename}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/characters/:id/frames/:anim/:frame/image — serve a frame PNG
app.get('/api/characters/:id/frames/:anim/:frame/image', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const filename = `${req.params['anim']}_${req.params['frame']}.png`;
    const filePath = path.join(charDir, req.params['anim']!, filename);
    await fs.access(filePath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    const data = await fs.readFile(filePath);
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT') || message.includes('no such file')) {
      res.status(404).json({ error: 'Frame image not found' });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// Allowed pipeline pass names
const VALID_PASSES = ['pending', 'pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];

// GET /api/characters/:id/frames/:anim/:frame/pass/:pass — serve an intermediate pass image
app.get('/api/characters/:id/frames/:anim/:frame/pass/:pass', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const pass = req.params['pass']!;
    if (!VALID_PASSES.includes(pass)) {
      res.status(400).json({ error: `Invalid pass: ${pass}` });
      return;
    }
    const animName = req.params['anim']!;
    const frameIdx = req.params['frame']!;
    const filename = `${animName}_${frameIdx}_${pass}.png`;
    const filePath = path.join(charDir, animName, filename);
    await fs.access(filePath);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    const data = await fs.readFile(filePath);
    res.send(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ENOENT') || message.includes('no such file')) {
      res.status(404).json({ error: 'Pass image not found' });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

// POST /api/characters/:id/frames/:anim/:frame/pass/:pass — save an intermediate pass image
app.post('/api/characters/:id/frames/:anim/:frame/pass/:pass', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
    const pass = req.params['pass']!;
    if (!VALID_PASSES.includes(pass)) {
      res.status(400).json({ error: `Invalid pass: ${pass}` });
      return;
    }
    const animName = req.params['anim']!;
    const animDir = path.join(charDir, animName);
    await fs.mkdir(animDir, { recursive: true });
    const frameIdx = req.params['frame']!;
    const filename = `${animName}_${frameIdx}_${pass}.png`;
    const filePath = path.join(animDir, filename);

    const data = await readBinaryBody(req);
    await fs.writeFile(filePath, data);
    console.log(`[REST] Pass image written: ${filePath} (${data.length} bytes)`);

    // Update pipeline_stage in manifest
    const manifestPath = path.join(charDir, 'manifest.json');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const anim = manifest.animations?.find((a: { name: string }) => a.name === animName);
      const fi = parseInt(frameIdx, 10);
      const frame = anim?.frames?.find((f: { index: number }) => f.index === fi);
      if (frame) {
        frame.pipeline_stage = pass;
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      }
    } catch { /* manifest update optional */ }

    res.json({ ok: true, path: filePath, bytes: data.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('Path traversal') ? 400 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/characters/:id/frames/:anim/:frame — get a specific frame's status
app.get('/api/characters/:id/frames/:anim/:frame', async (req: Request, res: Response) => {
  try {
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
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
    const charDir = safeResolve(getCharactersDir(), req.params['id']!);
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

// Resolve a user-supplied path: expand ~ to home dir, resolve relative to home.
function resolveUserPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.resolve(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return path.resolve(p);
  // Relative paths resolve against home directory for predictability
  return path.resolve(os.homedir(), p);
}

// ---------------------------------------------------------------------------
// Project endpoints
// ---------------------------------------------------------------------------

// POST /api/projects/create — create a new project directory
app.post('/api/projects/create', async (req: Request, res: Response) => {
  try {
    const { path: dirPath, name } = req.body as { path: string; name: string };
    if (!dirPath || !name) {
      res.status(400).json({ error: 'path and name are required' });
      return;
    }
    const projectDir = resolveUserPath(dirPath);
    const charsDir = path.join(projectDir, 'characters');
    await fs.mkdir(charsDir, { recursive: true });

    const project = {
      version: 1,
      name,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
      characters: [] as string[],
      ai_config: null,
      export_presets: {
        default: { format: 'spritesheet', include_characters: [], output_dir: 'export' },
      },
    };
    await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');

    activeProjectDir = projectDir;
    console.log(`[Bridge] Project created: ${projectDir}`);
    res.json({ ok: true, project });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/open — open an existing project
app.post('/api/projects/open', async (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body as { path: string };
    if (!dirPath) {
      res.status(400).json({ error: 'path is required' });
      return;
    }
    const projectDir = resolveUserPath(dirPath);
    const projectFile = path.join(projectDir, 'project.json');
    const content = await fs.readFile(projectFile, 'utf8');
    const project = JSON.parse(content);

    activeProjectDir = projectDir;
    console.log(`[Bridge] Project opened: ${projectDir}`);
    res.json({ ok: true, project, path: projectDir });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const statusCode = message.includes('ENOENT') ? 404 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// GET /api/projects/current — get current project meta
app.get('/api/projects/current', async (_req: Request, res: Response) => {
  if (!activeProjectDir) {
    res.json({ project: null, path: null });
    return;
  }
  try {
    const projectFile = path.join(activeProjectDir, 'project.json');
    const content = await fs.readFile(projectFile, 'utf8');
    const project = JSON.parse(content);
    res.json({ project, path: activeProjectDir });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/save — save project metadata
app.post('/api/projects/save', async (req: Request, res: Response) => {
  try {
    if (!activeProjectDir) {
      res.status(400).json({ error: 'No active project' });
      return;
    }
    const { project } = req.body as { project: Record<string, unknown> };
    if (!project) {
      res.status(400).json({ error: 'project body is required' });
      return;
    }
    project.modified_at = new Date().toISOString();
    const projectFile = path.join(activeProjectDir, 'project.json');
    await fs.writeFile(projectFile, JSON.stringify(project, null, 2), 'utf8');
    console.log(`[Bridge] Project saved: ${projectFile}`);
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// POST /api/projects/close — close active project
app.post('/api/projects/close', (_req: Request, res: Response) => {
  console.log(`[Bridge] Project closed: ${activeProjectDir}`);
  activeProjectDir = null;
  res.json({ ok: true });
});

// POST /api/projects/export — export characters
app.post('/api/projects/export', async (req: Request, res: Response) => {
  try {
    if (!activeProjectDir) {
      res.status(400).json({ error: 'No active project' });
      return;
    }
    const {
      characterIds,
      format = 'spritesheet',
      outputDir,
    } = req.body as { characterIds?: string[]; format?: string; outputDir?: string };

    // Dynamically import the export function
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (import('@vulkan-game-tools/atlas-assembler' as any) as Promise<any>);
    const exportFn = mod.exportCharacters;
    if (typeof exportFn !== 'function') {
      res.status(500).json({ error: 'Export function not available — update atlas-assembler' });
      return;
    }

    const charsDir = getCharactersDir();
    const exportDir = outputDir
      ? path.resolve(activeProjectDir, outputDir)
      : path.join(activeProjectDir, 'export');

    // If no characterIds specified, list all characters
    let ids = characterIds;
    if (!ids || ids.length === 0) {
      const entries = await fs.readdir(charsDir, { withFileTypes: true });
      ids = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mPath = path.join(charsDir, entry.name, 'manifest.json');
          try { await fs.access(mPath); ids.push(entry.name); } catch { /* skip */ }
        }
      }
    }

    const results = await exportFn(ids, {
      charactersDir: charsDir,
      outputDir: exportDir,
      format: format as 'spritesheet' | 'individual',
    });

    res.json({ ok: true, results });
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
