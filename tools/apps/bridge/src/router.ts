import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type WSServer } from './ws-server.js';
import { type UnixSocketClient } from './unix-client.js';
import { type RequestTracker } from './request-tracker.js';
import { type ProjectContext } from './context.js';

export function setupRouter(
  wsServer: WSServer,
  unixClient: UnixSocketClient,
  tracker: RequestTracker,
  ctx: ProjectContext,
): { forwardToEngine: (payload: Record<string, unknown>) => void } {
  // ---------------------------------------------------------------------------
  // Engine forwarding helper
  // ---------------------------------------------------------------------------

  /** Forward a fire-and-forget command to the engine. Never throws. */
  function forwardToEngine(payload: Record<string, unknown>): void {
    try {
      unixClient.send(JSON.stringify(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Bridge] forwardToEngine failed: ${message}`);
    }
  }

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
      const resolved = tracker.resolve(bridgeIdFromTool);
      delete parsed['_bridge_id'];

      // Reattach the client's original `id` so EngineClient can match responses.
      if (resolved?.originalId !== undefined) {
        parsed['id'] = resolved.originalId;
      }
      const outgoing = JSON.stringify(parsed);

      if (resolved) {
        console.log(`[Bridge] Tool->WS [${resolved.clientId}] id=${bridgeIdFromTool} type=${String(parsed['type'] ?? '?')}`);
        const sent = wsServer.sendTo(resolved.clientId, outgoing);
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
      const origId = parsed['id'];
      parsed['_bridge_id'] = bridgeId;
      delete parsed['id'];  // strip client id before forwarding
      tracker.track(bridgeId, clientId, origId);

      // Remove the target field before forwarding (tool doesn't need it)
      delete parsed['target'];

      const serialised = JSON.stringify(parsed);
      console.log(`[Bridge] WS->Tool [${target}] id=${bridgeId} cmd=${String(parsed['cmd'] ?? '?')}`);
      wsServer.sendTo(toolClientId, serialised);
      return;
    }

    // --- Default: forward to engine via Unix socket ---

    // Resolve relative PLY paths in load_scene_json when project root is known
    if (parsed['cmd'] === 'load_scene_json' && typeof parsed['json'] === 'string') {
      if (!ctx.activeProjectDir) {
        console.warn('[Bridge] WARNING: load_scene_json with no project root set — PLY paths may not resolve. Use File → "Connect Bridge to Project Root..." in Bricklayer.');
      }
    }
    if (parsed['cmd'] === 'load_scene_json' && ctx.activeProjectDir && typeof parsed['json'] === 'string') {
      try {
        const sceneObj = JSON.parse(parsed['json'] as string);
        const resolve = (p: string) => p && !p.startsWith('/') ? path.join(ctx.activeProjectDir!, p) : p;

        // Terrain PLY
        if (sceneObj.gaussian_splat?.ply_file) {
          sceneObj.gaussian_splat.ply_file = resolve(sceneObj.gaussian_splat.ply_file);
        }
        // Morph pair PLY
        if (sceneObj.gaussian_splat?.morph?.pair_ply) {
          sceneObj.gaussian_splat.morph.pair_ply = resolve(sceneObj.gaussian_splat.morph.pair_ply);
        }
        // Game object PLYs
        if (Array.isArray(sceneObj.game_objects)) {
          for (const go of sceneObj.game_objects) {
            if (go.ply_file) go.ply_file = resolve(go.ply_file);
          }
        }
        parsed['json'] = JSON.stringify(sceneObj);
        console.log(`[Bridge] Resolved PLY paths under ${ctx.activeProjectDir}`);
      } catch (e) {
        console.warn(`[Bridge] Failed to resolve PLY paths: ${e}`);
      }
    }

    const bridgeId = randomUUID();
    const origId = parsed['id'];
    parsed['_bridge_id'] = bridgeId;
    delete parsed['id'];  // strip client id before forwarding to engine
    tracker.track(bridgeId, clientId, origId);

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
      const resolved = tracker.resolve(bridgeId);

      // Strip the internal field before forwarding.
      delete parsed['_bridge_id'];

      // Reattach the client's original `id` so EngineClient can match responses.
      if (resolved?.originalId !== undefined) {
        parsed['id'] = resolved.originalId;
      }
      const outgoing = JSON.stringify(parsed);

      if (resolved) {
        console.log(`[Bridge] Unix->WS [${resolved.clientId}] id=${bridgeId} type=${String(parsed['type'] ?? '?')}`);
        const sent = wsServer.sendTo(resolved.clientId, outgoing);
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

  unixClient.onConnect(() => {
    // Replay project root on (re)connect so the engine can resolve asset paths.
    // This handles the case where the user sets project root before Staging starts.
    if (ctx.activeProjectDir) {
      console.log(`[Bridge] Replaying set_project_root: ${ctx.activeProjectDir}`);
      forwardToEngine({ cmd: 'set_project_root', path: ctx.activeProjectDir });
    }
    wsServer.broadcast(JSON.stringify({ type: 'engine_connected' }));
  });

  unixClient.onClose(() => {
    // Notify all connected tool clients so they can show a reconnecting indicator.
    wsServer.broadcast(JSON.stringify({ type: 'engine_disconnected' }));
  });

  unixClient.onError((err: Error) => {
    console.error(`[Bridge] Unix socket error: ${err.message}`);
  });

  return { forwardToEngine };
}
