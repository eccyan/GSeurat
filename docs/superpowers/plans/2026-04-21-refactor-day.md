# Refactor Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four behavior-preserving refactors: bridge URL dedup, bridge route extraction, ScenePropertiesPanel decomposition, and command_dispatcher lookup tables.

**Architecture:** Each refactor is independent and can execute in parallel via worktrees. All refactors are pure restructuring — no behavioral changes.

**Tech Stack:** TypeScript (pnpm monorepo), C++23, Express, Zustand, React

---

### Task 1: Bridge URL Constants

**Files:**
- Create: `tools/packages/engine-client/src/constants.ts`
- Modify: `tools/packages/engine-client/src/index.ts`
- Modify: `tools/packages/engine-client/src/bridge.ts:11`
- Modify: `tools/packages/engine-client/src/client.ts:21`

- [ ] **Step 1: Create the constants file**

```typescript
// tools/packages/engine-client/src/constants.ts
export const BRIDGE_WS_URL = 'ws://localhost:9100';
export const BRIDGE_REST_URL = 'http://localhost:9101';
```

- [ ] **Step 2: Re-export from index.ts**

In `tools/packages/engine-client/src/index.ts`, add:

```typescript
export * from "./constants.js";
```

So the file becomes:

```typescript
export * from "./client.js";
export * from "./types.js";
export * from "./bridge.js";
export * from "./constants.js";
```

- [ ] **Step 3: Update bridge.ts to use the constant**

In `tools/packages/engine-client/src/bridge.ts`, replace line 11:

```typescript
// Before:
const BRIDGE_URL = 'ws://localhost:9100';

// After:
import { BRIDGE_WS_URL } from './constants.js';
```

Then update all references from `BRIDGE_URL` to `BRIDGE_WS_URL` in the same file.

- [ ] **Step 4: Update client.ts to use the constant**

In `tools/packages/engine-client/src/client.ts`, add the import and replace the default parameter at line 21:

```typescript
// Before:
constructor(url: string = "ws://localhost:9100") {

// After:
import { BRIDGE_WS_URL } from './constants.js';
// ...
constructor(url: string = BRIDGE_WS_URL) {
```

- [ ] **Step 5: Verify engine-client builds**

Run: `cd tools && pnpm --filter @gseurat/engine-client build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add tools/packages/engine-client/src/constants.ts tools/packages/engine-client/src/index.ts tools/packages/engine-client/src/bridge.ts tools/packages/engine-client/src/client.ts
git commit -m "refactor(engine-client): extract shared bridge URL constants"
```

---

### Task 2: Update All Bridge URL Consumers

**Files:**
- Modify: `tools/apps/bricklayer/src/lib/bridgeConnection.ts:11`
- Modify: `tools/apps/echidna/src/panels/MenuBar.tsx:21`
- Modify: `tools/apps/weaver/src/components/MenuBar.tsx:7`
- Modify: `tools/apps/melies/src/App.tsx:191`
- Modify: `tools/apps/particle-designer/src/store/useParticleStore.ts:87`
- Modify: `tools/apps/level-designer/src/hooks/useEngine.ts:55`

- [ ] **Step 1: Update bricklayer bridgeConnection.ts**

Replace the local constant at line 11:

```typescript
// Before:
const BRIDGE_REST_URL = 'http://localhost:9101';

// After:
import { BRIDGE_REST_URL } from '@gseurat/engine-client';
```

- [ ] **Step 2: Update echidna MenuBar.tsx**

Replace the local constant at line 21:

```typescript
// Before:
const BRIDGE_REST_URL = 'http://localhost:9101';

// After:
import { BRIDGE_REST_URL } from '@gseurat/engine-client';
```

- [ ] **Step 3: Update weaver MenuBar.tsx**

Replace the local constant at line 7:

```typescript
// Before:
const BRIDGE_REST_URL = 'http://localhost:9101';

// After:
import { BRIDGE_REST_URL } from '@gseurat/engine-client';
```

- [ ] **Step 4: Update melies App.tsx**

Add import at top of file:

```typescript
import { BRIDGE_REST_URL } from '@gseurat/engine-client';
```

Replace the inline literal at line 191:

```typescript
// Before:
const res = await fetch('http://localhost:9101/api/project/root', {

// After:
const res = await fetch(`${BRIDGE_REST_URL}/api/project/root`, {
```

- [ ] **Step 5: Update particle-designer useParticleStore.ts**

Add import and replace hardcoded default at line 87:

```typescript
import { BRIDGE_WS_URL } from '@gseurat/engine-client';
// ...
// Before:
engineUrl: 'ws://localhost:9100',

// After:
engineUrl: BRIDGE_WS_URL,
```

- [ ] **Step 6: Update level-designer useEngine.ts**

Add import and replace hardcoded literal at line 55:

```typescript
import { BRIDGE_WS_URL } from '@gseurat/engine-client';
// ...
// Before:
const client = new mod.EngineClient('ws://localhost:9100') as EngineClientLike;

// After:
const client = new mod.EngineClient(BRIDGE_WS_URL) as EngineClientLike;
```

- [ ] **Step 7: Verify full build**

Run: `cd tools && pnpm build`
Expected: All packages and apps build successfully.

- [ ] **Step 8: Commit**

```bash
git add tools/apps/bricklayer/src/lib/bridgeConnection.ts tools/apps/echidna/src/panels/MenuBar.tsx tools/apps/weaver/src/components/MenuBar.tsx tools/apps/melies/src/App.tsx tools/apps/particle-designer/src/store/useParticleStore.ts tools/apps/level-designer/src/hooks/useEngine.ts
git commit -m "refactor: replace hardcoded bridge URLs with shared constants"
```

---

### Task 3: Bridge Route Extraction — Context and Utils

**Files:**
- Create: `tools/apps/bridge/src/context.ts`
- Create: `tools/apps/bridge/src/helpers.ts`

- [ ] **Step 1: Create context.ts**

Extract from `index.ts` lines 25-36 (the mutable state and helper functions):

```typescript
// tools/apps/bridge/src/context.ts
import path from 'node:path';
import { UnixSocketClient } from './unix-client.js';
import { WSServer } from './ws-server.js';
import { RequestTracker } from './request-tracker.js';
import { AsyncResourceLock } from './utils/AsyncResourceLock.js';

export class ProjectContext {
  activeProjectDir: string | null = null;
  readonly resourceLock = new AsyncResourceLock();

  getScenesDir(): string {
    if (!this.activeProjectDir) throw new Error('No project open');
    return path.join(this.activeProjectDir, 'scenes');
  }

  getTexturesDir(): string {
    if (!this.activeProjectDir) throw new Error('No project open');
    return path.join(this.activeProjectDir, 'textures');
  }

  getCharactersDir(): string {
    if (!this.activeProjectDir) throw new Error('No project open');
    return path.join(this.activeProjectDir, 'characters');
  }
}
```

Note: Read the actual bodies of `getScenesDir`, `getTexturesDir`, `getCharactersDir` from `index.ts` lines 27-35 to get the exact implementation. The above shows the pattern — copy the exact logic.

- [ ] **Step 2: Create helpers.ts**

Extract from `index.ts` lines 499-513 (the `readBinaryBody` helper that's duplicated 3x). Note: we use `helpers.ts` instead of `utils.ts` because a `utils/` directory already exists (containing `AsyncResourceLock.ts`).

```typescript
// tools/apps/bridge/src/helpers.ts
import type { Request } from 'express';

export async function readBinaryBody(req: Request): Promise<Buffer> {
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
```

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bridge/src/context.ts tools/apps/bridge/src/helpers.ts
git commit -m "refactor(bridge): extract ProjectContext and readBinaryBody helper"
```

---

### Task 4: Bridge Route Extraction — File Routes

**Files:**
- Create: `tools/apps/bridge/src/routes/files.ts`

- [ ] **Step 1: Create routes/files.ts**

Extract from `index.ts` lines 277-388 (scene and texture CRUD routes). The directory `tools/apps/bridge/src/routes/` may need to be created.

```typescript
// tools/apps/bridge/src/routes/files.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { ProjectContext } from '../context.js';

export function registerFileRoutes(app: Express, ctx: ProjectContext): void {
  // GET /api/files/scenes — list scene files
  app.get('/api/files/scenes', async (_req: Request, res: Response) => {
    // ... copy exact handler body from index.ts
  });

  // GET /api/files/scenes/:name — read a scene file
  app.get('/api/files/scenes/:name', async (req: Request, res: Response) => {
    // ... copy exact handler body from index.ts
  });

  // POST /api/files/scenes/:name — write a scene file
  app.post('/api/files/scenes/:name', async (req: Request, res: Response) => {
    // ... copy exact handler body from index.ts
  });

  // Repeat for texture endpoints (GET list, GET by name, POST by name)
}
```

Copy each handler body exactly from the current `index.ts`. Replace `getScenesDir()` with `ctx.getScenesDir()` and `getTexturesDir()` with `ctx.getTexturesDir()`.

- [ ] **Step 2: Commit**

```bash
git add tools/apps/bridge/src/routes/files.ts
git commit -m "refactor(bridge): extract file routes to routes/files.ts"
```

---

### Task 5: Bridge Route Extraction — Character Routes

**Files:**
- Create: `tools/apps/bridge/src/routes/characters.ts`

- [ ] **Step 1: Create routes/characters.ts**

Extract from `index.ts` lines 390-1059 (~670 lines of character CRUD). This is the largest extraction.

```typescript
// tools/apps/bridge/src/routes/characters.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { ProjectContext } from '../context.js';
import { readBinaryBody } from '../helpers.js';
import { exportPlyFromProject } from '../ply-export.js';
import type { EchidnaProject } from '../ply-export.js';

export function registerCharacterRoutes(app: Express, ctx: ProjectContext): void {
  // GET /api/characters — list characters
  app.get('/api/characters', async (_req: Request, res: Response) => {
    // ... copy exact handler body
  });

  // ... all character endpoints ...
  // Replace getCharactersDir() with ctx.getCharactersDir()
  // Replace all 3 inline readBinaryBody definitions with the imported one
  // Replace resourceLock with ctx.resourceLock
}
```

Copy every handler from lines 390-1059 exactly. Key replacements:
- `getCharactersDir()` → `ctx.getCharactersDir()`
- Inline `readBinaryBody` definitions (3 copies) → imported `readBinaryBody`
- `resourceLock` → `ctx.resourceLock`
- `activeProjectDir` → `ctx.activeProjectDir`

- [ ] **Step 2: Commit**

```bash
git add tools/apps/bridge/src/routes/characters.ts
git commit -m "refactor(bridge): extract character routes to routes/characters.ts"
```

---

### Task 6: Bridge Route Extraction — Project Routes

**Files:**
- Create: `tools/apps/bridge/src/routes/projects.ts`

- [ ] **Step 1: Create routes/projects.ts**

Extract from `index.ts` lines 1061-1271 (project lifecycle, tools, health).

```typescript
// tools/apps/bridge/src/routes/projects.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type { ProjectContext } from '../context.js';
import type { UnixSocketClient } from '../unix-client.js';

export function registerProjectRoutes(
  app: Express,
  ctx: ProjectContext,
  forwardToEngine: (payload: Record<string, unknown>) => void,
): void {
  // POST /api/project/root
  app.post('/api/project/root', async (req: Request, res: Response) => {
    // ... copy exact handler body
    // Replace activeProjectDir = ... with ctx.activeProjectDir = ...
  });

  // GET /api/project/root
  app.get('/api/project/root', (_req: Request, res: Response) => {
    // ... copy exact handler body
  });

  // POST /api/projects/create, /open, /save, /close, /export
  // GET /api/tools
  // GET /health

  // Replace all activeProjectDir references with ctx.activeProjectDir
  // Replace forwardToEngine calls — pass as parameter
}
```

The `forwardToEngine` function is needed by project routes (e.g., `set_project_root` command to engine). Pass it as a parameter rather than importing internal WS/Unix socket details.

- [ ] **Step 2: Commit**

```bash
git add tools/apps/bridge/src/routes/projects.ts
git commit -m "refactor(bridge): extract project routes to routes/projects.ts"
```

---

### Task 7: Bridge Route Extraction — Router and Testing

**Files:**
- Create: `tools/apps/bridge/src/router.ts`
- Create: `tools/apps/bridge/src/testing.ts`

- [ ] **Step 1: Create router.ts**

Extract from `index.ts` lines 89-275 (WS message routing and Unix socket forwarding):

```typescript
// tools/apps/bridge/src/router.ts
import type { UnixSocketClient } from './unix-client.js';
import type { WSServer } from './ws-server.js';
import type { RequestTracker } from './request-tracker.js';
import type { ProjectContext } from './context.js';

export function setupRouter(
  wsServer: WSServer,
  unixClient: UnixSocketClient,
  tracker: RequestTracker,
  ctx: ProjectContext,
): { forwardToEngine: (payload: Record<string, unknown>) => void } {

  function forwardToEngine(payload: Record<string, unknown>): void {
    // ... copy exact body from index.ts forwardToEngine function
  }

  // WS message handler
  wsServer.onMessage((rawMsg: string, clientId: string) => {
    // ... copy exact body from index.ts lines 89-205
    // Replace forwardToEngine calls with the local function
  });

  // Unix socket -> WS forwarder
  unixClient.onData((line: string) => {
    // ... copy exact body from index.ts lines 207-275
  });

  // Engine lifecycle hooks
  unixClient.onConnect(() => {
    // ... copy from index.ts
  });
  unixClient.onClose(() => {
    // ... copy from index.ts
  });
  unixClient.onError((err: Error) => {
    // ... copy from index.ts
  });

  return { forwardToEngine };
}
```

Return `forwardToEngine` so `index.ts` can pass it to `registerProjectRoutes`.

- [ ] **Step 2: Create testing.ts**

Extract from `index.ts` lines 1322-1355:

```typescript
// tools/apps/bridge/src/testing.ts
import http from 'node:http';
import type { Express } from 'express';
import type { ProjectContext } from './context.js';

let testServer: http.Server | null = null;
let testPort = 0;

export async function startBridgeForTesting(
  app: Express,
  opts: { port: number },
): Promise<void> {
  testServer = app.listen(opts.port);
  await new Promise<void>((r) => testServer!.once('listening', () => r()));
  const addr = testServer!.address();
  testPort = typeof addr === 'object' && addr ? addr.port : 0;
}

export function getTestPort(): number {
  return testPort;
}

export async function stopBridgeForTesting(ctx: ProjectContext): Promise<void> {
  if (testServer) {
    await new Promise<void>((r) => testServer!.close(() => r()));
    testServer = null;
    testPort = 0;
  }
  ctx.activeProjectDir = null;
}
```

Note: `stopBridgeForTesting` needs access to `ctx` to reset `activeProjectDir`. Check the exact current signature and adjust — the existing `getActiveProjectDir` export also needs to read from `ctx`.

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bridge/src/router.ts tools/apps/bridge/src/testing.ts
git commit -m "refactor(bridge): extract WS router and test helpers"
```

---

### Task 8: Bridge Route Extraction — Rewire index.ts

**Files:**
- Modify: `tools/apps/bridge/src/index.ts` (rewrite to thin orchestrator)

- [ ] **Step 1: Rewrite index.ts as thin orchestrator**

Replace the entire file with the slim wiring:

```typescript
// tools/apps/bridge/src/index.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { UnixSocketClient } from './unix-client.js';
import { WSServer } from './ws-server.js';
import { RequestTracker } from './request-tracker.js';
import { ProjectContext } from './context.js';
import { setupRouter } from './router.js';
import { registerFileRoutes } from './routes/files.js';
import { registerCharacterRoutes } from './routes/characters.js';
import { registerProjectRoutes } from './routes/projects.js';
import { startBridgeForTesting, stopBridgeForTesting, getTestPort } from './testing.js';

const UNIX_SOCKET_PATH = '/tmp/gseurat.sock';
const WS_PORT = 9100;
const HTTP_PORT = 9101;

const ctx = new ProjectContext();
const unixClient = new UnixSocketClient(2_000);
const wsServer = new WSServer(WS_PORT);
const tracker = new RequestTracker(30_000);

const app = express();

// CORS middleware
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

// Wire up router (WS + Unix socket forwarding)
const { forwardToEngine } = setupRouter(wsServer, unixClient, tracker, ctx);

// Wire up REST routes
registerFileRoutes(app, ctx);
registerCharacterRoutes(app, ctx);
registerProjectRoutes(app, ctx, forwardToEngine);

// Startup
async function main(): Promise<void> {
  console.log('[Bridge] Starting up ...');
  wsServer.start();
  try {
    await unixClient.connect(UNIX_SOCKET_PATH);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Bridge] Initial engine connection failed (${message}), will retry.`);
  }
  app.listen(HTTP_PORT, () => {
    console.log(`[Bridge] REST API listening on http://localhost:${HTTP_PORT}`);
  });
  console.log('[Bridge] Ready.');
}

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

// Test exports
export {
  startBridgeForTesting,
  stopBridgeForTesting,
  getTestPort,
  app,
};

export function getActiveProjectDir(): string | null {
  return ctx.activeProjectDir;
}
```

Verify that all exports match what `bridge-routing.test.ts` and any other consumers expect.

- [ ] **Step 2: Verify bridge builds**

Run: `cd tools && pnpm --filter bridge build`
Expected: Clean build, no errors.

- [ ] **Step 3: Run bridge tests**

Run: `cd tools && node --import tsx/esm --conditions source tests/src/bridge-routing.test.ts`
Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bridge/src/index.ts
git commit -m "refactor(bridge): rewire index.ts as thin orchestrator (~60 lines)"
```

---

### Task 9: ScenePropertiesPanel — Shared Components

**Files:**
- Create: `tools/apps/bricklayer/src/panels/editors/EntityHeader.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/TransformFields.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/utils.ts`
- Create: `tools/apps/bricklayer/src/panels/editors/ComponentEditor.tsx`

- [ ] **Step 1: Create editors directory and EntityHeader.tsx**

```bash
mkdir -p tools/apps/bricklayer/src/panels/editors
```

```tsx
// tools/apps/bricklayer/src/panels/editors/EntityHeader.tsx
import React from 'react';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

interface EntityHeaderProps {
  typeLabel: string;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
}

export function EntityHeader({ typeLabel, name, onNameChange, onRemove }: EntityHeaderProps) {
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>{typeLabel}</span>
        <button style={styles.btnDanger} onClick={onRemove}>Remove</button>
      </div>
      <div style={styles.section}>
        <label style={styles.label}>Name</label>
        <input
          style={styles.input}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
    </>
  );
}
```

Note: Read the exact repeated header pattern from `GameObjectProperties` (lines ~180-200), `LightProperties` (lines ~440-460), `GsEmitterProperties` (lines ~740-760) to match the exact JSX structure. The above shows the pattern — copy the exact markup and styles.

- [ ] **Step 2: Create TransformFields.tsx**

```tsx
// tools/apps/bricklayer/src/panels/editors/TransformFields.tsx
import React from 'react';
import { Vec3Input } from '../../components/Vec3Input.js';
import { NumberInput } from '../../components/NumberInput.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

type Vec3 = [number, number, number];

interface TransformFieldsProps {
  position: Vec3;
  onPositionChange: (v: Vec3) => void;
  rotation?: Vec3;
  onRotationChange?: (v: Vec3) => void;
  rotationScalar?: number;
  onRotationScalarChange?: (v: number) => void;
}

export function TransformFields({
  position, onPositionChange,
  rotation, onRotationChange,
  rotationScalar, onRotationScalarChange,
}: TransformFieldsProps) {
  return (
    <>
      <div style={styles.section}>
        <label style={styles.label}>Position</label>
        <Vec3Input value={position} onChange={onPositionChange} />
      </div>
      {rotation && onRotationChange && (
        <div style={styles.section}>
          <label style={styles.label}>Rotation</label>
          <Vec3Input value={rotation} onChange={onRotationChange} />
        </div>
      )}
      {rotationScalar !== undefined && onRotationScalarChange && (
        <div style={styles.section}>
          <label style={styles.label}>Rotation</label>
          <NumberInput value={rotationScalar} onChange={onRotationScalarChange} />
        </div>
      )}
    </>
  );
}
```

Read the actual transform field patterns from the entity editors to verify Vec3 vs scalar rotation usage per type.

- [ ] **Step 3: Create utils.ts**

Extract utility functions from `ScenePropertiesPanel.tsx`:

```typescript
// tools/apps/bricklayer/src/panels/editors/utils.ts

// From lines 727-737
export function rgbToHex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

// From line 418
export function getLightType(light: { direction?: unknown; outer_cone_angle?: unknown }): string {
  if (light.direction && light.outer_cone_angle != null) return 'spot';
  if (light.direction) return 'directional';
  return 'point';
}

// From lines 1062-1073
export function parseEasing(value: string): { type: string; dir: string } {
  if (value === 'linear') return { type: 'linear', dir: 'in' };
  for (const dir of ['in_out', 'out', 'in']) {
    if (value.startsWith(dir + '_')) return { type: value.slice(dir.length + 1), dir };
  }
  return { type: 'linear', dir: 'in' };
}

export function composeEasing(type: string, dir: string): string {
  if (type === 'linear') return 'linear';
  return `${dir}_${type}`;
}
```

Read the exact function bodies from the source to ensure fidelity (especially `getLightType` — verify the exact property checks).

- [ ] **Step 4: Create ComponentEditor.tsx**

Extract from `ScenePropertiesPanel.tsx` lines 43-176:

```tsx
// tools/apps/bricklayer/src/panels/editors/ComponentEditor.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { panelStyles } from '../../styles/panel.js';
import { rgbToHex, hexToRgb } from './utils.js';
import type { ComponentSchema, ComponentFieldSchema } from '../../store/types.js';

const styles = { ...panelStyles };

// Copy exact ComponentFieldEditor from lines 43-125
function ComponentFieldEditor({ field, value, onChange }: {
  field: ComponentFieldSchema;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // ... copy exact body from ScenePropertiesPanel.tsx lines 43-125
}

// Copy exact ComponentEditor from lines 127-176
export function ComponentEditor({ schema, data, onChange, onRemove }: {
  schema: ComponentSchema;
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
}) {
  // ... copy exact body from ScenePropertiesPanel.tsx lines 127-176
}
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/panels/editors/
git commit -m "refactor(bricklayer): create shared editor components (EntityHeader, TransformFields, ComponentEditor, utils)"
```

---

### Task 10: ScenePropertiesPanel — Extract Entity Editors

**Files:**
- Create: `tools/apps/bricklayer/src/panels/editors/GameObjectProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/LightProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/GsEmitterProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/GsAnimationProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/AudioZoneProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/VfxInstanceProperties.tsx`
- Create: `tools/apps/bricklayer/src/panels/editors/index.ts`

- [ ] **Step 1: Extract GameObjectProperties**

Copy from `ScenePropertiesPanel.tsx` lines 178-435. The component currently takes `{ obj: GameObjectData }`.

```tsx
// tools/apps/bricklayer/src/panels/editors/GameObjectProperties.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GameObjectData, PbdConfig } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';
import { ComponentEditor } from './ComponentEditor.js';

const styles = { ...panelStyles };

export function GameObjectProperties({ obj }: { obj: GameObjectData }) {
  const update = useSceneStore((s) => s.updateGameObject);
  const remove = useSceneStore((s) => s.removeGameObject);
  const componentSchemas = useSceneStore((s) => s.componentSchemas);

  return (
    <div>
      <EntityHeader
        typeLabel="Game Object"
        name={obj.name ?? obj.id}
        onNameChange={(name) => update(obj.id, { name })}
        onRemove={() => remove(obj.id)}
      />
      <TransformFields
        position={obj.position}
        onPositionChange={(position) => update(obj.id, { position })}
        rotation={obj.rotation}
        onRotationChange={(rotation) => update(obj.id, { rotation })}
      />
      {/* ... rest of the component body (dynamic components, PBD config, etc.) ... */}
    </div>
  );
}
```

Copy the exact body. Replace the header/name/transform pattern with `EntityHeader` and `TransformFields`. The rest of the component (dynamic components, PBD config, etc.) stays as-is.

- [ ] **Step 2: Extract LightProperties**

Copy from lines 436-726. Use `EntityHeader` for header. Import `rgbToHex`, `hexToRgb`, `getLightType` from `./utils.js`.

```tsx
// tools/apps/bricklayer/src/panels/editors/LightProperties.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { StaticLight } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';
import { rgbToHex, hexToRgb, getLightType } from './utils.js';

const styles = { ...panelStyles };

export function LightProperties({ light }: { light: StaticLight }) {
  const update = useSceneStore((s) => s.updateLight);
  const remove = useSceneStore((s) => s.removeLight);
  const lightType = getLightType(light);
  // ... copy exact body, replace header with EntityHeader
}
```

- [ ] **Step 3: Extract GsEmitterProperties**

Copy from lines 739-1061. Use `EntityHeader` and `TransformFields`.

```tsx
// tools/apps/bricklayer/src/panels/editors/GsEmitterProperties.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GsParticleEmitterData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';

const styles = { ...panelStyles };

export function GsEmitterProperties({ emitter }: { emitter: GsParticleEmitterData }) {
  const update = useSceneStore((s) => s.updateGsEmitter);
  const remove = useSceneStore((s) => s.removeGsEmitter);
  // ... copy exact body, replace header/transform with shared components
}
```

- [ ] **Step 4: Extract GsAnimationProperties**

Copy from lines 1075-1140 (`ParamRow`) and lines 1142-1289 (`GsAnimationProperties`). Import `parseEasing`, `composeEasing` from `./utils.js`.

```tsx
// tools/apps/bricklayer/src/panels/editors/GsAnimationProperties.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { GsAnimationGroupData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';
import { parseEasing, composeEasing } from './utils.js';

const styles = { ...panelStyles };

// Copy ParamRow from lines 1075-1140
function ParamRow(/* ... */) {
  // ... exact copy
}

export function GsAnimationProperties({ anim }: { anim: GsAnimationGroupData }) {
  const update = useSceneStore((s) => s.updateGsAnimation);
  const remove = useSceneStore((s) => s.removeGsAnimation);
  // ... copy exact body, replace header with EntityHeader
}
```

- [ ] **Step 5: Extract AudioZoneProperties and VfxInstanceProperties**

```tsx
// tools/apps/bricklayer/src/panels/editors/AudioZoneProperties.tsx
import React from 'react';
import { AudioZonePanel } from '../../components/AudioZonePanel.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { AudioZoneData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';

const styles = { ...panelStyles };

export function AudioZoneProperties({ zone }: { zone: AudioZoneData }) {
  const update = useSceneStore((s) => s.updateAudioZone);
  const remove = useSceneStore((s) => s.removeAudioZone);
  // ... copy exact body from lines 1291-1319
}
```

```tsx
// tools/apps/bricklayer/src/panels/editors/VfxInstanceProperties.tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { useSceneStore } from '../../store/useSceneStore.js';
import type { VfxInstanceData } from '../../store/types.js';
import { panelStyles } from '../../styles/panel.js';
import { EntityHeader } from './EntityHeader.js';
import { TransformFields } from './TransformFields.js';

const styles = { ...panelStyles };

export function VfxInstanceProperties({ vfx }: { vfx: VfxInstanceData }) {
  const update = useSceneStore((s) => s.updateVfxInstance);
  const remove = useSceneStore((s) => s.removeVfxInstance);
  const editingSpline = useSceneStore((s) => s.editingSpline);
  // ... copy exact body from lines 1323-1452
}
```

- [ ] **Step 6: Create barrel export**

```typescript
// tools/apps/bricklayer/src/panels/editors/index.ts
export { GameObjectProperties } from './GameObjectProperties.js';
export { LightProperties } from './LightProperties.js';
export { GsEmitterProperties } from './GsEmitterProperties.js';
export { GsAnimationProperties } from './GsAnimationProperties.js';
export { AudioZoneProperties } from './AudioZoneProperties.js';
export { VfxInstanceProperties } from './VfxInstanceProperties.js';
export { EntityHeader } from './EntityHeader.js';
export { TransformFields } from './TransformFields.js';
export { ComponentEditor } from './ComponentEditor.js';
```

- [ ] **Step 7: Commit**

```bash
git add tools/apps/bricklayer/src/panels/editors/
git commit -m "refactor(bricklayer): extract all entity editors to panels/editors/"
```

---

### Task 11: ScenePropertiesPanel — Rewire Dispatcher

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` (rewrite)

- [ ] **Step 1: Rewrite ScenePropertiesPanel.tsx as thin dispatcher**

```tsx
// tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';
import { CameraVolumeEditor } from './CameraVolumeEditor.js';
import { CameraTriggerEditor } from './CameraTriggerEditor.js';
import { CameraRailEditor } from './CameraRailEditor.js';
import {
  GameObjectProperties,
  LightProperties,
  GsEmitterProperties,
  GsAnimationProperties,
  AudioZoneProperties,
  VfxInstanceProperties,
} from './editors/index.js';

const styles = { ...panelStyles };

export function ScenePropertiesPanel() {
  useComponentRegistry('ScenePropertiesPanel');
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const staticLights = useSceneStore((s) => s.staticLights);
  const gsParticleEmitters = useSceneStore((s) => s.gsParticleEmitters);
  const gsAnimations = useSceneStore((s) => s.gsAnimations);
  const vfxInstances = useSceneStore((s) => s.vfxInstances);
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const cameraTriggers = useSceneStore((s) => s.cameraTriggers);
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const audioZones = useSceneStore((s) => s.audioZones);

  if (!selectedEntity) {
    return <div style={styles.empty}>Select an entity in the scene tree</div>;
  }

  if (selectedEntity.type === 'game_object') {
    const obj = gameObjects.find((o) => o.id === selectedEntity.id);
    if (!obj) return <div style={styles.empty}>Game object not found</div>;
    return <GameObjectProperties obj={obj} />;
  }

  if (selectedEntity.type === 'light') {
    const light = staticLights.find((l) => l.id === selectedEntity.id);
    if (!light) return <div style={styles.empty}>Light not found</div>;
    return <LightProperties light={light} />;
  }

  if (selectedEntity.type === 'gs_emitter') {
    const emitter = gsParticleEmitters.find((e) => e.id === selectedEntity.id);
    if (!emitter) return <div style={styles.empty}>Emitter not found</div>;
    return <GsEmitterProperties emitter={emitter} />;
  }

  if (selectedEntity.type === 'gs_animation') {
    const anim = gsAnimations.find((a) => a.id === selectedEntity.id);
    if (!anim) return <div style={styles.empty}>Animation not found</div>;
    return <GsAnimationProperties anim={anim} />;
  }

  if (selectedEntity.type === 'vfx_instance') {
    const vfx = vfxInstances.find((v) => v.id === selectedEntity.id);
    if (!vfx) return <div style={styles.empty}>VFX instance not found</div>;
    return <VfxInstanceProperties vfx={vfx} />;
  }

  if (selectedEntity.type === 'camera_volume') {
    const vol = cameraVolumes.find((v) => v.id === selectedEntity.id);
    if (!vol) return <div style={styles.empty}>Camera volume not found</div>;
    return <CameraVolumeEditor volume={vol} />;
  }

  if (selectedEntity.type === 'camera_trigger') {
    const trig = cameraTriggers.find((t) => t.id === selectedEntity.id);
    if (!trig) return <div style={styles.empty}>Camera trigger not found</div>;
    return <CameraTriggerEditor trigger={trig} />;
  }

  if (selectedEntity.type === 'camera_rail') {
    const rail = cameraRails.find((r) => r.id === selectedEntity.id);
    if (!rail) return <div style={styles.empty}>Camera rail not found</div>;
    return <CameraRailEditor rail={rail} />;
  }

  if (selectedEntity.type === 'audio_zone') {
    const zone = audioZones.find((z) => z.id === selectedEntity.id);
    if (!zone) return <div style={styles.empty}>Audio zone not found</div>;
    return <AudioZoneProperties zone={zone} />;
  }

  return <div style={styles.empty}>Unknown entity type</div>;
}
```

Note: We keep the if/else dispatch pattern here (matching the existing camera editors' prop shapes) rather than a component map, because each editor takes a differently-named prop (`obj`, `light`, `emitter`, `anim`, `vfx`, `volume`, `trigger`, `rail`, `zone`). The value of this refactor is in extracting the 1,400+ lines of editor code, not in changing the dispatch pattern.

- [ ] **Step 2: Verify bricklayer builds**

Run: `cd tools && pnpm --filter bricklayer build`
Expected: Clean build, no errors.

- [ ] **Step 3: Update expected-components.json if needed**

Check `tools/apps/bricklayer/src/expected-components.json`. The current file references `ScenePropertiesPanel` (still exists), plus camera and audio zone editors in `conditional`. The new editor components don't need entries since they're rendered inside `ScenePropertiesPanel`, not as standalone registered components. No changes needed unless the component registry health check flags something.

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx
git commit -m "refactor(bricklayer): slim ScenePropertiesPanel to thin dispatcher (~80 lines)"
```

---

### Task 12: Command Dispatcher — `set_feature` Lookup Table

**Files:**
- Modify: `src/engine/command_dispatcher.cpp:82-104`

- [ ] **Step 1: Replace set_feature if/else with FeatureFlags::entries() lookup**

`FeatureFlags` already has a `static constexpr entries()` method (in `include/gseurat/engine/feature_flags.hpp:89-125`) that returns an array of `{ name, phase, category, ptr }` where `ptr` is a `bool FeatureFlags::*`. Use this directly.

Replace lines 82-104:

```cpp
// Before (lines 82-104):
register_command("set_feature", [this, ok](const json& cmd) -> CommandResult {
    auto name = cmd.value("feature", "");
    bool enabled = cmd.value("enabled", false);
    auto& f = ctx_.feature_flags;
    if (name == "gs_rendering") f.gs_rendering = enabled;
    else if (name == "gs_chunk_culling") f.gs_chunk_culling = enabled;
    // ... 15 more branches ...
    return ok();
});

// After:
register_command("set_feature", [this, ok](const json& cmd) -> CommandResult {
    const auto name = cmd.value("feature", "");
    const bool enabled = cmd.value("enabled", false);
    auto& f = ctx_.feature_flags;

    // Build lookup from the authoritative FeatureFlags::entries() table.
    static const auto flag_map = [] {
        std::unordered_map<std::string, bool FeatureFlags::*> m;
        for (const auto& e : FeatureFlags::entries()) {
            // entries() uses display names ("GS Rendering"), but the wire
            // protocol uses snake_case field names. Map by member pointer
            // identity against known field names.
        }
        return m;
    }();

    // Actually, FeatureFlags::entries() uses display names, not wire names.
    // The simplest correct approach: a static map with the wire names.
    static const std::unordered_map<std::string, bool FeatureFlags::*> flag_map = {
        {"gs_rendering",       &FeatureFlags::gs_rendering},
        {"gs_chunk_culling",   &FeatureFlags::gs_chunk_culling},
        {"gs_lod",             &FeatureFlags::gs_lod},
        {"gs_adaptive_budget", &FeatureFlags::gs_adaptive_budget},
        {"gs_parallax",        &FeatureFlags::gs_parallax},
        {"gs_tile_binning",    &FeatureFlags::gs_tile_binning},
        {"bloom",              &FeatureFlags::bloom},
        {"depth_of_field",     &FeatureFlags::depth_of_field},
        {"vignette",           &FeatureFlags::vignette},
        {"tone_mapping",       &FeatureFlags::tone_mapping},
        {"fog",                &FeatureFlags::fog},
        {"point_lights",       &FeatureFlags::point_lights},
        {"particles",          &FeatureFlags::particles},
        {"weather",            &FeatureFlags::weather},
        {"screen_effects",     &FeatureFlags::screen_effects},
        {"music",              &FeatureFlags::music},
        {"sfx",                &FeatureFlags::sfx},
    };

    auto it = flag_map.find(name);
    if (it != flag_map.end()) {
        f.*(it->second) = enabled;
    }
    return ok();
});
```

Note: Unknown feature names silently succeed (matching current behavior where the if/else falls through to `return ok()`).

- [ ] **Step 2: Build**

Run: `cmake --build --preset macos-debug`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/engine/command_dispatcher.cpp
git commit -m "refactor(command-dispatcher): replace set_feature if/else with lookup table"
```

---

### Task 13: Command Dispatcher — `set_render_param` Lookup Table

**Files:**
- Modify: `src/engine/command_dispatcher.cpp:141-189`

- [ ] **Step 1: Replace set_render_param if/else with function map**

The `set_render_param` handler has three categories of branches:
1. Simple `pp.*` field assignments (13 branches)
2. Method calls on `gs` or `ctx_.renderer` (5 branches)
3. Read-modify-write color channel patterns (6 branches)

Replace lines 141-189:

```cpp
// Before (lines 141-189):
register_command("set_render_param", [this, ok](const json& cmd) -> CommandResult {
    auto name = cmd.value("name", "");
    float value = cmd.value("value", 0.0f);
    auto& pp = ctx_.renderer.post_process_params();
    auto& gs = ctx_.renderer.gs_renderer();
    if (name == "bloom_threshold") pp.bloom_threshold = value;
    // ... 21 more branches ...
    return ok();
});

// After:
register_command("set_render_param", [this, ok](const json& cmd) -> CommandResult {
    const auto name = cmd.value("name", "");
    const float value = cmd.value("value", 0.0f);
    auto& pp = ctx_.renderer.post_process_params();
    auto& gs = ctx_.renderer.gs_renderer();

    using Setter = std::function<void(float)>;
    static std::unordered_map<std::string, Setter> param_map;
    // Lazy-init: lambdas capture pp/gs/ctx_ by reference via `this`,
    // but pp and gs are reference-getters that must be called each time.
    // So we rebuild the map each call — but since it's just pointer
    // assignments, it's negligible cost.
    //
    // Actually, since pp and gs are references obtained at the start of
    // the handler, we can build the map inline each call. The map is
    // not static because it captures stack references.
    const std::unordered_map<std::string, Setter> param_map = {
        // Simple post-process field assignments
        {"bloom_threshold",    [&](float v) { pp.bloom_threshold = v; }},
        {"bloom_soft_knee",    [&](float v) { pp.bloom_soft_knee = v; }},
        {"bloom_intensity",    [&](float v) { pp.bloom_intensity = v; }},
        {"exposure",           [&](float v) { pp.exposure = v; }},
        {"vignette_radius",    [&](float v) { pp.vignette_radius = v; }},
        {"vignette_softness",  [&](float v) { pp.vignette_softness = v; }},
        {"dof_focus_distance", [&](float v) { pp.dof_focus_distance = v; }},
        {"dof_focus_range",    [&](float v) { pp.dof_focus_range = v; }},
        {"dof_max_blur",       [&](float v) { pp.dof_max_blur = v; }},
        {"fog_density",        [&](float v) { pp.fog_density = v; }},
        {"fog_color_r",        [&](float v) { pp.fog_color_r = v; }},
        {"fog_color_g",        [&](float v) { pp.fog_color_g = v; }},
        {"fog_color_b",        [&](float v) { pp.fog_color_b = v; }},
        // Method calls
        {"god_rays_intensity", [&](float v) { ctx_.renderer.set_god_rays_intensity(v); }},
        {"scale_multiplier",   [&](float v) { gs.set_scale_multiplier(v); }},
        {"toon_bands",         [&](float v) { gs.set_toon_bands(static_cast<int>(v)); }},
        {"light_mode",         [&](float v) { gs.set_light_mode(static_cast<int>(v)); }},
        {"light_intensity",    [&](float v) { gs.set_light_intensity(v); }},
        // Ground color channels (read-modify-write)
        {"ground_color_r",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.r = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
        {"ground_color_g",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.g = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
        {"ground_color_b",     [&](float v) { auto c = ctx_.renderer.gs_bg_ground_color(); c.b = v; ctx_.renderer.set_gs_background_colors(c, ctx_.renderer.gs_bg_sky_color()); }},
        // Sky color channels (read-modify-write)
        {"sky_color_r",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.r = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
        {"sky_color_g",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.g = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
        {"sky_color_b",        [&](float v) { auto c = ctx_.renderer.gs_bg_sky_color(); c.b = v; ctx_.renderer.set_gs_background_colors(ctx_.renderer.gs_bg_ground_color(), c); }},
    };

    auto it = param_map.find(name);
    if (it != param_map.end()) {
        it->second(value);
    }
    return ok();
});
```

Note: The map is NOT static because the lambdas capture `pp` and `gs` by reference (stack locals). This is fine — the map construction is trivial (24 pointer-sized entries) and happens only when the command is called. Unknown param names silently succeed (matching current behavior).

- [ ] **Step 2: Build**

Run: `cmake --build --preset macos-debug`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/engine/command_dispatcher.cpp
git commit -m "refactor(command-dispatcher): replace set_render_param if/else with lookup table"
```

---

### Task 14: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript build**

Run: `cd tools && pnpm build`
Expected: All packages and apps build with no errors.

- [ ] **Step 2: Full C++ build**

Run: `cmake --build --preset macos-debug`
Expected: Clean build.

- [ ] **Step 3: Run bridge routing tests**

Run: `cd tools && node --import tsx/esm --conditions source tests/src/bridge-routing.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Verify no hardcoded bridge URLs remain**

Run: `grep -r "localhost:9100\|localhost:9101" tools/apps/ tools/packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v test`
Expected: No matches outside test files and the constants definition.

- [ ] **Step 5: Commit (if any fixes needed)**

Only if previous steps required fixes.
