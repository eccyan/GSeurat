# Refactor Day — April 21, 2026

Four targeted refactors to reduce monolith size, eliminate duplication, and improve code organization across the TypeScript tooling layer and C++ command dispatcher.

## 1. Bridge URL Dedup

### Problem

`localhost:9100` (WS) and `localhost:9101` (REST) are hardcoded in 11 locations across 6+ apps. Each app defines its own local constant or inline literal.

### Solution

Export shared constants from `@gseurat/engine-client`:

```typescript
// tools/packages/engine-client/src/constants.ts
export const BRIDGE_WS_URL = 'ws://localhost:9100';
export const BRIDGE_REST_URL = 'http://localhost:9101';
```

Re-export from the package entry point. Update all consumers:

| File | Current | After |
|---|---|---|
| `bricklayer/src/lib/bridgeConnection.ts:11` | local `BRIDGE_REST_URL` | import from `@gseurat/engine-client` |
| `echidna/src/panels/MenuBar.tsx:21` | local `BRIDGE_REST_URL` | import from `@gseurat/engine-client` |
| `weaver/src/components/MenuBar.tsx:7` | local `BRIDGE_REST_URL` | import from `@gseurat/engine-client` |
| `melies/src/App.tsx:191` | inline literal | import from `@gseurat/engine-client` |
| `particle-designer/src/store/useParticleStore.ts:87` | hardcoded default | import from `@gseurat/engine-client` |
| `level-designer/src/hooks/useEngine.ts:55` | hardcoded literal | import from `@gseurat/engine-client` |
| `engine-client/src/bridge.ts:11` | file-scoped `BRIDGE_URL` | import from `./constants` |
| `engine-client/src/client.ts:21` | default parameter | import from `./constants` |

Tests (`bridge-routing.test.ts`) keep their own literals since they test specific ports.

### Constraints

- No new packages. Constants live in `engine-client` which all apps already depend on.
- Existing `bridge.ts` and `client.ts` within engine-client also consume the new constants.

## 2. Bridge `index.ts` Route Extraction

### Problem

`tools/apps/bridge/src/index.ts` is 1,355 lines containing WS routing, 27 REST handlers, character CRUD (~670 lines), project lifecycle, and test helpers in a single file.

### Solution

Split into focused modules:

```
tools/apps/bridge/src/
├── index.ts           # ~60 lines: imports, wires Express + WS + context, main()
├── context.ts         # ~40 lines: ProjectContext class
├── router.ts          # ~190 lines: WS message routing + Unix socket forwarding
├── testing.ts         # ~35 lines: test helpers (startBridgeForTesting, etc.)
├── utils.ts           # ~15 lines: readBinaryBody (currently duplicated 3x)
└── routes/
    ├── files.ts       # ~110 lines: scene & texture CRUD
    ├── characters.ts  # ~670 lines: character asset CRUD, atlas, PLY export
    └── projects.ts    # ~210 lines: project lifecycle, tools, health
```

#### `context.ts` — Shared State

Replace the mutable module-level `activeProjectDir` singleton with a `ProjectContext` object:

```typescript
export class ProjectContext {
  activeProjectDir: string | null = null;

  getScenesDir(): string { /* ... */ }
  getTexturesDir(): string { /* ... */ }
  getCharactersDir(): string { /* ... */ }
}
```

Passed to each route module's registration function: `registerCharacterRoutes(app, ctx)`.

#### Route Module Pattern

Each route module exports a single registration function:

```typescript
// routes/files.ts
export function registerFileRoutes(app: Express, ctx: ProjectContext): void {
  app.get('/api/files/scenes/:name', async (req, res) => { /* ... */ });
  // ...
}
```

#### `router.ts` — WebSocket + Unix Socket

Handles:
- WS message routing (tool registration, tool-response passthrough, engine forwarding)
- `load_scene_json` PLY path rewriting
- Unix socket -> WS forwarding with `_bridge_id` routing
- Engine lifecycle hooks (onConnect, onClose, onError)

#### `utils.ts` — Dedup `readBinaryBody`

The helper appears at lines 503–513, 659–665, and 757–767. Extract once:

```typescript
export function readBinaryBody(req: IncomingMessage): Promise<Buffer> { /* ... */ }
```

#### `index.ts` — Thin Orchestrator

```typescript
import { ProjectContext } from './context';
import { setupRouter } from './router';
import { registerFileRoutes } from './routes/files';
import { registerCharacterRoutes } from './routes/characters';
import { registerProjectRoutes } from './routes/projects';

async function main() {
  const ctx = new ProjectContext();
  const app = express();
  // ... create WS server, Unix client ...
  setupRouter(wsServer, unixClient, ctx);
  registerFileRoutes(app, ctx);
  registerCharacterRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  // ... listen ...
}
```

### Constraints

- All existing REST endpoints and WS message formats remain unchanged.
- `testing.ts` exports the same `startBridgeForTesting` / `stopBridgeForTesting` / `getActiveProjectDir` API.
- No changes to the bridge's public behavior or port assignments.

## 3. ScenePropertiesPanel Decomposition

### Problem

`ScenePropertiesPanel.tsx` is 1,526 lines with 9 entity-type editors. 6 are inlined with copy-pasted header/name/transform patterns. The dispatch is a flat if/else chain.

### Solution

Extract to `panels/editors/`:

```
tools/apps/bricklayer/src/panels/
├── ScenePropertiesPanel.tsx    # ~80 lines: thin dispatcher with component map
└── editors/
    ├── index.ts                # barrel export
    ├── EntityHeader.tsx        # ~40 lines: shared type label + name input + remove button
    ├── TransformFields.tsx     # ~30 lines: position + rotation Vec3Inputs
    ├── ComponentEditor.tsx     # ~135 lines: ComponentFieldEditor + ComponentEditor
    ├── GameObjectProperties.tsx # ~260 lines
    ├── LightProperties.tsx     # ~300 lines
    ├── GsEmitterProperties.tsx # ~320 lines
    ├── GsAnimationProperties.tsx # ~180 lines (includes ParamRow)
    ├── AudioZoneProperties.tsx # ~30 lines
    ├── VfxInstanceProperties.tsx # ~150 lines
    └── utils.ts               # ~30 lines: rgbToHex, hexToRgb, getLightType, parseEasing, composeEasing
```

#### `EntityHeader.tsx` — Shared Pattern

Eliminates the copy-pasted header across 5+ editors:

```tsx
interface EntityHeaderProps {
  typeLabel: string;
  name: string;
  onNameChange: (name: string) => void;
  onRemove: () => void;
}

export function EntityHeader({ typeLabel, name, onNameChange, onRemove }: EntityHeaderProps) {
  // type label row + remove button + name input
}
```

#### `TransformFields.tsx` — Shared Pattern

```tsx
interface TransformFieldsProps {
  position: Vec3;
  rotation?: Vec3 | number;
  onPositionChange: (v: Vec3) => void;
  onRotationChange?: (v: Vec3 | number) => void;
}
```

#### Thin Dispatcher

Replace the if/else chain with a component map:

```tsx
const EDITOR_MAP: Record<string, React.ComponentType<{ id: string }>> = {
  game_object: GameObjectProperties,
  light: LightProperties,
  gs_emitter: GsEmitterProperties,
  gs_animation: GsAnimationProperties,
  vfx_instance: VfxInstanceProperties,
  camera_volume: CameraVolumeEditor,
  camera_trigger: CameraTriggerEditor,
  camera_rail: CameraRailEditor,
  audio_zone: AudioZoneProperties,
};

export function ScenePropertiesPanel() {
  const selectedEntity = useSceneStore(s => s.selectedEntity);
  if (!selectedEntity) return <EmptyState />;
  const Editor = EDITOR_MAP[selectedEntity.type];
  if (!Editor) return <EmptyState />;
  return <Editor id={selectedEntity.id} />;
}
```

Each editor component is responsible for its own store lookup by `id`, which keeps the dispatcher minimal.

### Constraints

- Existing camera editors (`CameraVolumeEditor`, `CameraTriggerEditor`, `CameraRailEditor`) are not moved — they stay in their current locations and are just added to the map.
- No changes to store shapes or entity types.
- The `expected-components.json` for bricklayer must be updated if it tracks panel components.

## 4. `command_dispatcher.cpp` Lookup Tables

### Problem

`set_feature` (17 branches) and `set_render_param` (22 branches) use string-keyed if/else chains where each branch does a simple field assignment.

### Solution

Replace with static dispatch tables.

#### `set_feature` — Pointer-to-Member Map

```cpp
using FeatureFlag = bool Engine::Settings::*;

static const std::unordered_map<std::string, FeatureFlag> feature_flags = {
    {"show_grid",         &Engine::Settings::show_grid},
    {"show_gizmos",       &Engine::Settings::show_gizmos},
    {"enable_fog",        &Engine::Settings::enable_fog},
    // ... 14 more entries
};

register_command("set_feature", [this](const json& params, json& response) {
    auto name = params.value("name", "");
    auto value = params.value("value", false);
    auto it = feature_flags.find(name);
    if (it != feature_flags.end()) {
        settings_.*it->second = value;
        response["status"] = "ok";
    } else {
        response["error"] = "unknown feature: " + name;
    }
});
```

#### `set_render_param` — Function Map

More complex because branches have different value types (float, int, color channels):

```cpp
using ParamSetter = std::function<void(const nlohmann::json&)>;

static const std::unordered_map<std::string, ParamSetter> render_params = {
    {"fog_density", [this](const json& p) {
        settings_.fog_density = p.value("value", 0.0f);
    }},
    {"ground_color_r", [this](const json& p) {
        settings_.ground_color.r = p.value("value", 0.0f);
    }},
    // ... 20 more entries
};
```

Both maps are initialized once in `register_default_commands`. The `static const` on the map structure ensures no repeated allocation; the lambdas capture `this` for access to `settings_`.

### Constraints

- Exact same JSON wire format and response shape.
- Unknown feature/param names return an error response (same as current behavior for the else branch, or adding one if currently missing).
- No changes to `Engine::Settings` struct or any other files.

## Testing Strategy

All four refactors are behavior-preserving:

1. **Bridge URL dedup**: `pnpm build` across all tools — verifies imports resolve.
2. **Bridge route extraction**: Existing `bridge-routing.test.ts` covers the REST API. Manual smoke test of WS message routing via bricklayer connecting to bridge.
3. **ScenePropertiesPanel**: `pnpm build` for bricklayer. Visual spot-check: select each entity type in bricklayer, verify properties panel renders correctly.
4. **Command dispatcher**: `cmake --build --preset macos-debug` + existing Game Director integration tests that exercise `set_feature` and `set_render_param` commands.

## Execution Order

These four refactors are independent and can be executed in parallel via worktrees. Suggested ordering if sequential:

1. Bridge URL dedup (quick win, touches many files but trivially)
2. Bridge route extraction (largest, benefits from URL dedup being done)
3. ScenePropertiesPanel decomposition (independent of bridge work)
4. Command dispatcher lookup tables (independent, C++ side)
