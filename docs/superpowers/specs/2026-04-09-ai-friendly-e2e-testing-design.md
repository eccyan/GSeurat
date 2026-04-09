# AI-Friendly End-to-End Testing Infrastructure

## Goal

Make GSeurat's UI self-reporting so AI systems can verify their own work the way a human would. Bugs announce themselves rather than requiring the debugger to go looking.

## Problem Statement

Three recurring issues when AI implements UI features:

1. **Orphaned components** — AI creates a React component file but doesn't import or render it in the parent tree. The build succeeds, but the UI doesn't change. The human has to point out "that hasn't changed."
2. **Silent failures** — React crashes (e.g., `undefined.toFixed()`) kill the component subtree with no visible error. ImGui panels positioned off-screen are invisible on smaller displays. The AI has no way to know something is wrong.
3. **No user-scenario verification** — Tests verify logic in isolation but don't follow the workflows a level designer would. Data integrity across the Bricklayer → Staging pipeline isn't automatically checked.

## Architecture

Four components, layered:

```
┌─────────────────────────────────────────────────┐
│  4. CLAUDE.md Checklist (safety net)             │
├─────────────────────────────────────────────────┤
│  3. Scenario Runner (Game Director)              │
│     Chains 1 + 2 into user-realistic workflows   │
├──────────────────────┬──────────────────────────┤
│  1. Component        │  2. Visual State Report   │
│     Registry         │     + Snapshot Diff        │
│  (React web apps)    │  (Staging C++ / socket)    │
└──────────────────────┴──────────────────────────┘
```

## Component 1: React Component Registry

**Package:** `@gseurat/ui-kit` (shared by Bricklayer, Echidna, Méliès)

### Registry Class

A singleton on `window.__COMPONENT_REGISTRY__` that tracks mounted components:

```typescript
interface ComponentHealth {
  mounted: string[];        // currently mounted component names
  expected: string[];       // from manifest for current mode
  missing: string[];        // expected but not mounted
  unexpected: string[];     // mounted but not in manifest
  errors: CapturedError[];  // React errors caught by ErrorBoundary
}

class ComponentRegistry {
  mount(name: string): void;
  unmount(name: string): void;
  reportError(name: string, error: Error): void;
  health(): ComponentHealth;
  reset(): void;
}
```

### useComponentRegistry Hook

```typescript
function useComponentRegistry(name: string): void {
  useEffect(() => {
    registry.mount(name);
    return () => registry.unmount(name);
  }, [name]);
}
```

Every panel and editor component calls this hook at the top of its function body.

### Expected Component Manifests

Each app has an `expected-components.json` that declares which components should be mounted per mode/state:

```json
{
  "always": ["MenuBar", "Viewport"],
  "modes": {
    "TERRAIN": ["TerrainLeftPanel", "TerrainRightPanel"],
    "SCENE": ["ProjectTree", "ScenePropertiesPanel"],
    "SETTINGS": ["SettingsRightPanel"]
  },
  "conditional": {
    "CameraVolumeEditor": "when a camera volume is selected",
    "CameraRailEditor": "when a camera rail is selected"
  }
}
```

The `health()` method compares `mounted` against `expected` for the current mode. Conditional components (like `CameraVolumeEditor`) are excluded from `missing` — they only appear when their trigger condition is met. The `unexpected` list contains components that are mounted but not declared in `always`, the current mode, or `conditional`.

### ErrorBoundary Component

```typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo): void;
  render(): React.ReactNode; // red banner with error message + children
}
```

Each app's `main.tsx` imports `ErrorBoundary` from `@gseurat/ui-kit` and wraps `<App>`. Caught errors are reported to the registry and rendered as a visible red banner (not silent).

### AI Verification

```javascript
// Via Chrome MCP javascript_tool on any web app:
JSON.stringify(window.__COMPONENT_REGISTRY__.health())
// → { "missing": ["CameraVolumeEditor"], "errors": [] }
```

## Component 2: Staging Visual State Report + Snapshot Diff

**Location:** Staging C++ app, exposed via Game Director socket

### visual_state Command

A single command that reports everything currently visible:

```json
{
  "panels": [
    {"name": "Render Settings", "visible": true, "on_screen": true, "pos": [1020, 30], "size": [250, 400]},
    {"name": "GS Parameters", "visible": true, "on_screen": false, "pos": [1020, 440], "size": [250, 250]}
  ],
  "gizmos": {
    "lights": {"enabled": true, "count": 3},
    "camera_zones": {"enabled": true, "count": 2},
    "camera_rails": {"enabled": false, "count": 0},
    "emitters": {"enabled": true, "count": 5},
    "game_objects": {"enabled": true, "count": 8},
    "vfx_instances": {"enabled": false, "count": 0}
  },
  "scene": {
    "gaussians_visible": 4521,
    "gaussians_total": 12000,
    "game_objects_loaded": 8,
    "terrain_loaded": true,
    "character_visible": true
  },
  "features": {
    "bloom": true,
    "dof": false,
    "pbd_physics": true,
    "vfx": true,
    "gs_particles": true
  },
  "camera_review": {
    "active": false,
    "player_pos": null,
    "active_zone": null
  }
}
```

**Implementation:** Collects data from existing internal state:
- Panels: ImGui window pos/size vs `ImGui::GetIO().DisplaySize`
- Gizmos: View menu toggle booleans + count of active instances
- Scene: existing perf counters and scene loading state
- Features: existing feature flag system
- Camera review: existing camera review state

### Snapshot Diff

```bash
# Save current state
python3 scripts/game_director.py snapshot save before_edit

# ... make changes, rebuild, relaunch ...

# Compare
python3 scripts/game_director.py snapshot diff before_edit
# → {
#   "changed": {
#     "scene.gaussians_total": {"was": 12000, "now": 8000},
#     "gizmos.lights.count": {"was": 3, "now": 0}
#   },
#   "added": {},
#   "removed": {}
# }
```

**Storage:** Snapshots saved as JSON in `/tmp/gseurat_snapshots/<name>.json`. Ephemeral — cleared on reboot.

### Panel Off-Screen Detection

The `on_screen` field for each panel is computed as:

```cpp
bool on_screen = (pos.x + size.x > 0) && (pos.x < display_size.x)
              && (pos.y + size.y > 0) && (pos.y < display_size.y);
```

Panels that are toggled visible but positioned off-screen report `visible: true, on_screen: false` — a clear signal that something is wrong.

## Component 3: Game Director Scenario Runner

**Location:** `scripts/game_director.py`, new `scenario` subcommand

### Interface

```bash
python3 scripts/game_director.py scenario list
python3 scripts/game_director.py scenario <name>
python3 scripts/game_director.py scenario all
```

### Scenario Structure

Each scenario is a Python function that:
1. Sets up preconditions (launch app, navigate to URL)
2. Executes user steps (click, type, send socket commands)
3. Asserts expected outcomes (registry health, visual_state fields, console errors)
4. Reports pass/fail per step

### Built-In Scenarios

| Scenario | Steps | Asserts |
|----------|-------|---------|
| `bricklayer_panels` | Switch between Terrain/Scene/Settings modes | Component registry matches manifest per mode |
| `bricklayer_camera_zones` | Create volume → send to Staging → review | CameraVolumeEditor mounted, zone count in Staging visual_state |
| `bricklayer_game_objects` | Add object with PBD → send to Staging | Game object in visual_state, PBD active in features |
| `echidna_panels` | Switch between Sculpt/Rig/Animate modes | Component registry healthy per mode |
| `staging_panels` | Launch Staging with scene | All panels on_screen in visual_state |
| `staging_camera_review` | Activate review → walk → zone transition | camera_review.active, player_pos changes, zone name updates |
| `full_pipeline` | Bricklayer author → Staging review → playtest | End-to-end data integrity across apps |

### Output Format

```
=== Scenario: bricklayer_camera_zones ===
  PASS  Step 1: Bricklayer loaded (0.8s)
  PASS  Step 2: Component registry healthy (0.1s)
  PASS  Step 3: Scene tab active (0.2s)
  PASS  Step 4: Camera volume created (0.3s)
  FAIL  Step 5: CameraVolumeEditor NOT mounted - missing from registry
RESULT: FAIL (1 of 5 steps failed)
```

### Scenario Dependencies

Scenarios that involve Bricklayer use Chrome MCP tools (`mcp__claude-in-chrome__*`). Scenarios that involve Staging use Game Director socket commands. Cross-app scenarios use both.

Scenarios do NOT require the demo app — they test the tooling pipeline (Bricklayer + Staging), not the game.

## Component 4: CLAUDE.md Checklist

Added to the project's CLAUDE.md as a mandatory post-implementation verification:

```markdown
## UI Implementation Checklist

After creating or modifying any UI component, verify ALL of the following:

### React (Bricklayer / Echidna / Méliès)
1. New component is imported in its parent
2. New component is rendered in JSX (not just imported)
3. Component is listed in expected-components.json for the relevant app/mode
4. Build succeeds (pnpm build in tools/)
5. Run component registry health check via Chrome MCP — no missing components
6. Read browser console — no React errors

### Staging (C++ ImGui)
1. New panel/widget has a draw call in staging_state.cpp
2. Panel is registered in the View menu toggle
3. Build succeeds (cmake --build --preset macos-debug)
4. Run visual_state via Game Director — new element appears
5. Run snapshot diff — only intended changes present

### Cross-App (Bricklayer to Staging)
1. Data created in Bricklayer reaches Staging via "Open in Staging"
2. Run relevant scenario (python3 scripts/game_director.py scenario <name>)
```

## What Is NOT In Scope

- **Visual regression with baseline screenshots** — adds maintenance burden, explore later if needed
- **Automated CI for scenario runner** — scenarios require running apps with GPU; keep as local dev tool for now
- **Méliès-specific scenarios** — add when Méliès has more interactive features to test
- **Demo app testing** — Game Director's existing `tour` and `playtest` commands already cover this

## Testing Strategy

Each component is independently testable:

1. **Component Registry** — unit tests in Vitest: mount/unmount/health/error reporting
2. **Visual State** — C++ unit test: mock panel positions, verify on_screen detection
3. **Snapshot Diff** — C++ unit test: compare two state structs, verify diff output
4. **Scenario Runner** — manual execution against running apps; scenarios self-report pass/fail
5. **Integration** — run `scenario all` after any UI feature implementation
