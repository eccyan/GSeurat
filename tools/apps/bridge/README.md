# Bridge Proxy

Relay server between the Vulkan engine's Unix domain socket and the browser-based tool apps. Provides a WebSocket interface for real-time bidirectional messaging and a REST API for file I/O operations.

## What It Does

The engine exposes a JSON Lines control server over `/tmp/gseurat.sock` (Phase 14). Browser apps cannot connect to Unix sockets directly, so the bridge:

1. Maintains a persistent connection to the engine socket.
2. Accepts WebSocket connections from tool apps on port 9100.
3. Forwards tool commands to the engine and relays responses back, adding request ID correlation so tools can await specific replies.
4. Broadcasts unsolicited engine events (dialog transitions, state changes) to all connected tools.
5. Exposes a REST API on port 9101 for reading and writing asset files on disk.

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 9100 | WebSocket | Real-time engine command relay |
| 9101 | HTTP | Asset file read/write REST API |

## Configuration

Environment variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `SOCKET_PATH` | `/tmp/gseurat.sock` | Path to the engine Unix socket |
| `WS_PORT` | `9100` | WebSocket server port |
| `HTTP_PORT` | `9101` | REST API server port |
| `ENGINE_DIR` | `../../build/macos-debug` | Root directory for asset file paths |

Set variables in a `.env` file in `apps/bridge/` or export them in your shell before running.

## Running

```bash
cd tools/apps/bridge
pnpm start          # production
pnpm dev            # watch mode with auto-restart
```

## REST Endpoints

### Scene Files

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/files/scenes/:name` | Read a scene JSON file from `assets/scenes/` |
| `POST` | `/api/files/scenes/:name` | Write a scene JSON file to `assets/scenes/` |

### Texture Files

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/files/textures/:name` | Read a PNG texture as base64 from `assets/` |
| `POST` | `/api/files/textures/:name` | Write a base64-encoded PNG texture to `assets/` |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok","engine_connected":bool}` |

## WebSocket Protocol

### Sending Commands

Clients attach a `_bridge_id` string to any command object. The bridge strips it before forwarding to the engine and re-attaches it to the matching response so the caller can correlate replies.

```json
{ "cmd": "get_state", "_bridge_id": "req-001" }
```

Response delivered only to the requesting client:

```json
{ "type": "state", "tick": 1234, "player": { ... }, "_bridge_id": "req-001" }
```

### Event Broadcasting

Engine events without a request ID are broadcast to all connected WebSocket clients:

```json
{ "type": "dialog_started", "npc_id": 1, "line": 0 }
{ "type": "dialog_ended" }
```

### Engine Disconnection

If the engine process is not running, the bridge accepts tool connections normally but responds to commands with:

```json
{ "type": "error", "message": "engine not connected", "_bridge_id": "req-001" }
```

Tools should check `/health` on startup and display an appropriate warning.
