# AI-Friendly End-to-End Testing Infrastructure

## Goal

Make GSeurat's UI self-reporting so AI systems can verify their own work the way a human would. Bugs announce themselves rather than requiring the debugger to go looking.

## Problem Statement

Three recurring issues when AI implements UI features:

1. **Orphaned components** — AI creates a React component file but doesn't import or render it in the parent tree. The build succeeds, but the UI doesn't change. The human has to point out "that hasn't changed."
2. **Silent failures** — React crashes (e.g., `undefined.toFixed()`) kill the component subtree with no visible error. ImGui panels positioned off-screen are invisible on smaller displays. The AI has no way to know something is wrong.
3. **No user-scenario verification** — Tests verify logic in isolation but don't follow the workflows a level designer would. Data integrity across the Bricklayer → Staging pipeline isn't automatically checked.

## Architecture

Five components, layered:

```
┌─────────────────────────────────────────────────┐
│  5. CLAUDE.md Checklist (safety net)             │
├─────────────────────────────────────────────────┤
│  4. Role-Specific Skills (scenario workflows)    │
│     Level Designer / Model Designer /            │
│     VFX Designer / Sound Designer                │
├─────────────────────────────────────────────────┤
│  3. Scenario Runner (shared test harness)        │
│     Chains 1 + 2 into assertions                 │
├──────────────────────┬──────────────────────────┤
│  1. Component        │  2. Visual State Report   │
│     Registry         │     + Snapshot Diff        │
│  (React web apps)    │  (Staging C++ / socket)    │
└──────────────────────┴──────────────────────────┘
```

## Role-Based Skill Design

The current Game Director skill covers too many concerns. Split into role-specific Claude Code skills that mirror how human creators work:

| Skill | Location | Primary App(s) | Scope |
|-------|----------|----------------|-------|
| **Level Designer** | `~/.claude/skills/level-designer/` | Bricklayer (5180) + Staging | Terrain, scene layout, camera zones, game objects, collision, lighting, nav zones |
| **Model Designer** | `~/.claude/skills/model-designer/` | Echidna (5179) + Staging | Voxel characters, rigging, bone animation, posing, PLY export |
| **VFX Designer** | `~/.claude/skills/vfx-designer/` | Méliès (5181) + Staging | Particle effects, VFX composition, emitter regions, animation regions |
| **Sound Designer** | `~/.claude/skills/sound-designer/` | Audio Composer | Music composition, SFX design, audio triggers, spatial audio |
| **Game Director** | `~/.claude/skills/game-director/` (existing, scoped down) | Demo app only | Runtime playtesting, tours, screenshots, perf checks via socket |

Each role skill defines:
- **Setup:** How to launch the app(s) for this role
- **Workflows:** Step-by-step user scenarios specific to this role
- **Verification:** Which Component Registry checks, Visual State assertions, and scenarios to run
- **Handoff:** How to send work to the next role (e.g., Level Designer → Game Director for playtesting)

### Skill Interaction Flow

```
Model Designer (Echidna)     VFX Designer (Méliès)     Sound Designer (Audio Composer)
     │ PLY + manifest              │ VFX scenes                 │ Audio assets
     └──────────┬──────────────────┘                            │
                ▼                                               │
Level Designer (Bricklayer + Staging)◄──────────────────────────┘
     │ Complete scene
     ▼
Game Director (Demo app)
     │ Playtest verification
     ▼
   Ship
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

## Component 3: Scenario Runner (Shared Test Harness)

**Location:** `scripts/scenario_runner.py` (new file, separate from game_director.py)

### Interface

```bash
# Run scenarios by role
python3 scripts/scenario_runner.py --role level-designer
python3 scripts/scenario_runner.py --role model-designer
python3 scripts/scenario_runner.py --role vfx-designer
python3 scripts/scenario_runner.py --role sound-designer

# Run a specific scenario
python3 scripts/scenario_runner.py --scenario camera_zones

# Run all scenarios
python3 scripts/scenario_runner.py --all

# List available scenarios
python3 scripts/scenario_runner.py --list
```

### Scenario Structure

Each scenario is a Python function that:
1. Sets up preconditions (launch app, navigate to URL)
2. Executes user steps (click, type, send socket commands)
3. Asserts expected outcomes (registry health, visual_state fields, console errors)
4. Reports pass/fail per step

### Scenarios by Role

**Level Designer:**

| Scenario | Steps | Asserts |
|----------|-------|---------|
| `bricklayer_panels` | Switch between Terrain/Scene/Settings modes | Component registry matches manifest per mode |
| `camera_zones` | Create volume → send to Staging → review | CameraVolumeEditor mounted, zone count in visual_state |
| `game_objects` | Add object with PBD → send to Staging | Game object in visual_state, PBD active |
| `lighting` | Add lights → send to Staging | Light count in visual_state gizmos |
| `staging_panels` | Launch Staging with scene | All panels on_screen |
| `staging_camera_review` | Activate review → walk → zone transition | camera_review state updates |
| `full_pipeline` | Author → review → playtest | End-to-end data integrity |

**Model Designer:**

| Scenario | Steps | Asserts |
|----------|-------|---------|
| `echidna_panels` | Switch between Sculpt/Rig/Animate modes | Component registry healthy per mode |
| `vox_import` | Import .vox → verify voxel grid | Voxel count > 0, component mounted |
| `rig_and_pose` | Assign parts → set joints → pose | Bone count correct, PLY export valid |
| `character_to_staging` | Export PLY → load in Staging | character_visible in visual_state |

**VFX Designer:**

| Scenario | Steps | Asserts |
|----------|-------|---------|
| `melies_panels` | Switch between emitter/composition modes | Component registry healthy |
| `emitter_create` | Create emitter with regions | Emitter in registry, params set |
| `vfx_to_staging` | Export VFX → load in Staging | vfx_instances count in visual_state |

**Sound Designer:**

| Scenario | Steps | Asserts |
|----------|-------|---------|
| `composer_panels` | Open Audio Composer | Component registry healthy |
| `sfx_create` | Create SFX with parameters | Audio file exported, params valid |

### Output Format

```
=== Role: Level Designer (4 scenarios) ===

--- Scenario: camera_zones ---
  PASS  Step 1: Bricklayer loaded (0.8s)
  PASS  Step 2: Component registry healthy (0.1s)
  PASS  Step 3: Scene tab active (0.2s)
  PASS  Step 4: Camera volume created (0.3s)
  FAIL  Step 5: CameraVolumeEditor NOT mounted - missing from registry
RESULT: FAIL (1 of 5 steps failed)

--- Scenario: staging_panels ---
  PASS  Step 1: Staging launched (2.1s)
  PASS  Step 2: All panels on_screen (0.3s)
RESULT: PASS

SUMMARY: 1 of 2 scenarios passed
```

### Dependencies

Scenarios that involve web apps use Chrome MCP tools (`mcp__claude-in-chrome__*`). Scenarios that involve Staging use socket commands. Cross-app scenarios use both. The scenario runner imports from `game_director.py` for socket communication — it does not duplicate that logic.

## Component 4: Role-Specific Claude Code Skills

**Location:** `~/.claude/skills/<role>/SKILL.md`

Each skill file tells the AI how to work as that role. Structure:

```markdown
# <Role> Skill

## When to Use
- Triggers (user asks to "design a level", "create a character", etc.)

## Setup
- How to launch the app(s)
- Prerequisites (build, assets)

## Workflows
- Step-by-step procedures for common tasks
- Which app, which panel, what order

## Verification
- Which scenarios to run after implementation
- Component registry checks specific to this role
- Visual state assertions specific to this role

## Handoff
- How to pass work to the next role in the pipeline
```

### Level Designer Skill

Covers the full Bricklayer + Staging workflow:
- Terrain editing (heightmap, collision grid, nav zones)
- Scene composition (game objects, props, PLY placement)
- Camera system (zones, rails, triggers, review mode)
- Lighting (point/spot/area lights, emissive, god rays)
- Verification via `scenario_runner.py --role level-designer`
- Handoff to Game Director for playtesting

### Model Designer Skill

Covers Echidna + animation workflow:
- Voxel sculpting and .vox import
- Body part assignment and rigging
- Joint placement and bone hierarchy
- Pose editing and animation authoring
- PLY export with bone indices
- Verification via `scenario_runner.py --role model-designer`
- Handoff to Level Designer for scene placement

### VFX Designer Skill

Covers Méliès + Staging VFX workflow:
- Emitter creation and configuration
- Region setup (spawn, animation)
- VFX composition and layering
- Verification via `scenario_runner.py --role vfx-designer`
- Handoff to Level Designer for scene integration

### Sound Designer Skill

Covers Audio Composer workflow:
- Music composition and layering
- SFX creation and parameter tuning
- Audio trigger configuration
- Verification via `scenario_runner.py --role sound-designer`
- Handoff to Level Designer for scene integration

### Game Director Skill (Scoped Down)

Existing skill, reduced to demo-app-only concerns:
- Runtime playtesting (`tour`, `playtest`)
- Screenshot capture and analysis
- Performance monitoring (`perf`)
- Trigger verification (`triggers`)
- Player navigation (`walk`, `goto`)
- No longer responsible for Bricklayer/Echidna/Méliès workflows

## Component 5: CLAUDE.md Checklist

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
7. Run role-specific scenarios (python3 scripts/scenario_runner.py --role <role>)

### Staging (C++ ImGui)
1. New panel/widget has a draw call in staging_state.cpp
2. Panel is registered in the View menu toggle
3. Build succeeds (cmake --build --preset macos-debug)
4. Run visual_state via Game Director — new element appears
5. Run snapshot diff — only intended changes present

### Cross-App (Bricklayer to Staging)
1. Data created in Bricklayer reaches Staging via "Open in Staging"
2. Run relevant role scenario (python3 scripts/scenario_runner.py --role level-designer)
```

## What Is NOT In Scope

- **Visual regression with baseline screenshots** — adds maintenance burden, explore later if needed
- **Automated CI for scenario runner** — scenarios require running apps with GPU; keep as local dev tool for now
- **Demo app testing** — Game Director's existing `tour` and `playtest` commands already cover this
- **Role skill content authoring** — each skill's detailed workflow documentation is written during implementation, not specified here

## Testing Strategy

Each component is independently testable:

1. **Component Registry** — unit tests in Vitest: mount/unmount/health/error reporting
2. **Visual State** — C++ unit test: mock panel positions, verify on_screen detection
3. **Snapshot Diff** — C++ unit test: compare two state structs, verify diff output
4. **Scenario Runner** — manual execution against running apps; scenarios self-report pass/fail
5. **Role Skills** — verify each skill file is loadable and references valid scenarios
6. **Integration** — run `scenario_runner.py --all` after any UI feature implementation
