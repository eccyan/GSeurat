# AI-Friendly End-to-End Testing Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GSeurat's UI self-reporting so AI can verify its own work — component registry for React apps, visual state introspection for Staging, scenario runner for user workflows, and role-specific skills.

**Architecture:** Shared `@gseurat/ui-kit` gains a ComponentRegistry + ErrorBoundary. Staging C++ app exposes `visual_state` + `snapshot` commands via socket. A standalone `scenario_runner.py` chains browser automation + socket commands into role-specific test scenarios. Four Claude Code skills (Level Designer, VFX Designer, Sound Designer, scoped-down Game Director) codify verification workflows.

**Tech Stack:** TypeScript/React (ui-kit, Bricklayer, Echidna, Méliès), C++23 (Staging, nlohmann/json), Python 3 (scenario runner, game director), Vitest (TS tests), CTest (C++ tests)

**Spec:** `docs/superpowers/specs/2026-04-09-ai-friendly-e2e-testing-design.md`

---

## File Structure

### Component 1: React Component Registry
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `tools/packages/ui-kit/src/ComponentRegistry.ts` | Registry class, health check, window global |
| Create | `tools/packages/ui-kit/src/useComponentRegistry.ts` | React hook for mount/unmount tracking |
| Create | `tools/packages/ui-kit/src/ErrorBoundary.tsx` | Error boundary with visible banner + registry reporting |
| Modify | `tools/packages/ui-kit/src/index.ts` | Export new modules |
| Create | `tools/apps/bricklayer/src/expected-components.json` | Bricklayer component manifest |
| Modify | `tools/apps/bricklayer/src/main.tsx` | Wrap App with ErrorBoundary, init registry |
| Create | `tools/apps/echidna/src/expected-components.json` | Echidna component manifest |
| Modify | `tools/apps/echidna/src/main.tsx` | Wrap mount with ErrorBoundary, init registry |
| Create | `tools/apps/melies/src/expected-components.json` | Méliès component manifest |
| Modify | `tools/apps/melies/src/main.tsx` | Wrap App with ErrorBoundary, init registry |
| Test | `tools/packages/ui-kit/src/__tests__/ComponentRegistry.test.ts` | Unit tests for registry |

### Component 2: Staging Visual State
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `include/gseurat/staging/visual_state.hpp` | VisualState struct + to_json |
| Create | `src/staging/visual_state.cpp` | Serialization, panel bounds check |
| Modify | `src/staging/staging_state.cpp` | Register `visual_state` command, expose panel/gizmo state |
| Modify | `scripts/game_director.py` | Add `visual_state`, `snapshot save/diff/list` commands |
| Test | `tests/test_visual_state.cpp` | Unit tests for bounds check + diff |

### Component 3: Scenario Runner
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/scenario_runner.py` | Scenario harness: Chrome MCP + socket assertions |

### Component 4: Role Skills
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `~/.claude/skills/level-designer/SKILL.md` | Level designer workflow + verification |
| Create | `~/.claude/skills/vfx-designer/SKILL.md` | VFX designer workflow + verification |
| Create | `~/.claude/skills/sound-designer/SKILL.md` | Sound designer workflow + verification |
| Modify | `~/.claude/skills/model-designer/SKILL.md` | Add animation scope + verification section |
| Modify | `~/.claude/skills/game-director/SKILL.md` | Scope down to demo-only playtesting |

### Component 5: CLAUDE.md Checklist
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `CLAUDE.md` | Add UI Implementation Checklist |

---

### Task 1: Component Registry Class

**Files:**
- Create: `tools/packages/ui-kit/src/ComponentRegistry.ts`
- Create: `tools/packages/ui-kit/src/__tests__/ComponentRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tools/packages/ui-kit/src/__tests__/ComponentRegistry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentRegistry } from '../ComponentRegistry.js';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  it('tracks mounted components', () => {
    registry.mount('MenuBar');
    registry.mount('Viewport');
    expect(registry.health().mounted).toEqual(['MenuBar', 'Viewport']);
  });

  it('removes unmounted components', () => {
    registry.mount('MenuBar');
    registry.mount('Viewport');
    registry.unmount('Viewport');
    expect(registry.health().mounted).toEqual(['MenuBar']);
  });

  it('reports missing components from manifest', () => {
    registry.setManifest({
      always: ['MenuBar', 'Viewport'],
      modes: { SCENE: ['ProjectTree', 'ScenePropertiesPanel'] },
      conditional: { CameraVolumeEditor: 'when a camera volume is selected' },
    });
    registry.setMode('SCENE');
    registry.mount('MenuBar');
    // Viewport and ProjectTree and ScenePropertiesPanel are missing
    const health = registry.health();
    expect(health.missing).toContain('Viewport');
    expect(health.missing).toContain('ProjectTree');
    expect(health.missing).toContain('ScenePropertiesPanel');
    // Conditional components are NOT in missing
    expect(health.missing).not.toContain('CameraVolumeEditor');
  });

  it('reports unexpected components', () => {
    registry.setManifest({
      always: ['MenuBar'],
      modes: {},
      conditional: {},
    });
    registry.mount('MenuBar');
    registry.mount('SomeOrphan');
    expect(registry.health().unexpected).toEqual(['SomeOrphan']);
  });

  it('tracks errors', () => {
    registry.reportError('Viewport', new Error('undefined is not a function'));
    const health = registry.health();
    expect(health.errors).toHaveLength(1);
    expect(health.errors[0].component).toBe('Viewport');
    expect(health.errors[0].message).toBe('undefined is not a function');
  });

  it('reset clears all state', () => {
    registry.mount('MenuBar');
    registry.reportError('X', new Error('boom'));
    registry.reset();
    const health = registry.health();
    expect(health.mounted).toEqual([]);
    expect(health.errors).toEqual([]);
  });

  it('handles duplicate mount gracefully', () => {
    registry.mount('MenuBar');
    registry.mount('MenuBar');
    expect(registry.health().mounted).toEqual(['MenuBar']);
  });

  it('handles unmount of non-mounted component gracefully', () => {
    registry.unmount('DoesNotExist');
    expect(registry.health().mounted).toEqual([]);
  });
});
```

- [ ] **Step 2: Add vitest to ui-kit**

Add to `tools/packages/ui-kit/package.json` devDependencies and scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "react": "^18.0.0",
    "typescript": "^5.0.0",
    "vitest": "^4.0.0"
  }
}
```

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm install
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter @gseurat/ui-kit test
```
Expected: FAIL — `ComponentRegistry` module not found

- [ ] **Step 4: Implement ComponentRegistry**

Create `tools/packages/ui-kit/src/ComponentRegistry.ts`:

```typescript
export interface CapturedError {
  component: string;
  message: string;
  timestamp: number;
}

export interface ComponentHealth {
  mounted: string[];
  expected: string[];
  missing: string[];
  unexpected: string[];
  errors: CapturedError[];
}

export interface ComponentManifest {
  always: string[];
  modes: Record<string, string[]>;
  conditional: Record<string, string>;
}

export class ComponentRegistry {
  private mounted_ = new Set<string>();
  private errors_: CapturedError[] = [];
  private manifest_: ComponentManifest = { always: [], modes: {}, conditional: {} };
  private mode_ = '';

  mount(name: string): void {
    this.mounted_.add(name);
  }

  unmount(name: string): void {
    this.mounted_.delete(name);
  }

  reportError(component: string, error: Error): void {
    this.errors_.push({
      component,
      message: error.message,
      timestamp: Date.now(),
    });
  }

  setManifest(manifest: ComponentManifest): void {
    this.manifest_ = manifest;
  }

  setMode(mode: string): void {
    this.mode_ = mode;
  }

  health(): ComponentHealth {
    const mounted = [...this.mounted_].sort();
    const expected = [
      ...this.manifest_.always,
      ...(this.manifest_.modes[this.mode_] ?? []),
    ];
    const conditionalNames = new Set(Object.keys(this.manifest_.conditional));
    const expectedSet = new Set(expected);
    const missing = expected.filter((name) => !this.mounted_.has(name));
    const unexpected = mounted.filter(
      (name) => !expectedSet.has(name) && !conditionalNames.has(name),
    );

    return { mounted, expected, missing, unexpected, errors: [...this.errors_] };
  }

  reset(): void {
    this.mounted_.clear();
    this.errors_ = [];
  }
}

/** Singleton registry, also exposed on window for AI inspection. */
export const componentRegistry = new ComponentRegistry();

if (typeof window !== 'undefined') {
  (window as any).__COMPONENT_REGISTRY__ = componentRegistry;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter @gseurat/ui-kit test
```
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add tools/packages/ui-kit/src/ComponentRegistry.ts tools/packages/ui-kit/src/__tests__/ComponentRegistry.test.ts tools/packages/ui-kit/package.json
git commit -m "feat(ui-kit): add ComponentRegistry with health check and tests"
```

---

### Task 2: useComponentRegistry Hook

**Files:**
- Create: `tools/packages/ui-kit/src/useComponentRegistry.ts`
- Modify: `tools/packages/ui-kit/src/index.ts`

- [ ] **Step 1: Create the hook**

Create `tools/packages/ui-kit/src/useComponentRegistry.ts`:

```typescript
import { useEffect } from 'react';
import { componentRegistry } from './ComponentRegistry.js';

/**
 * Registers a component in the ComponentRegistry on mount,
 * unregisters on unmount. Call at the top of every panel/editor component.
 */
export function useComponentRegistry(name: string): void {
  useEffect(() => {
    componentRegistry.mount(name);
    return () => {
      componentRegistry.unmount(name);
    };
  }, [name]);
}
```

- [ ] **Step 2: Export from index.ts**

Add to `tools/packages/ui-kit/src/index.ts`:

```typescript
export { ComponentRegistry, componentRegistry } from "./ComponentRegistry";
export type { ComponentHealth, ComponentManifest, CapturedError } from "./ComponentRegistry";

export { useComponentRegistry } from "./useComponentRegistry";
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter @gseurat/ui-kit test
```
Expected: Still all PASS

- [ ] **Step 4: Commit**

```bash
git add tools/packages/ui-kit/src/useComponentRegistry.ts tools/packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add useComponentRegistry hook"
```

---

### Task 3: ErrorBoundary Component

**Files:**
- Create: `tools/packages/ui-kit/src/ErrorBoundary.tsx`
- Modify: `tools/packages/ui-kit/src/index.ts`

- [ ] **Step 1: Create ErrorBoundary**

Create `tools/packages/ui-kit/src/ErrorBoundary.tsx`:

```tsx
import React from 'react';
import { componentRegistry } from './ComponentRegistry.js';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ error, errorInfo });
    componentRegistry.reportError('ErrorBoundary', error);
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            padding: '16px 24px',
            background: '#cc0000',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 14,
            zIndex: 99999,
          }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
            React Error — component tree crashed
          </div>
          <div>{this.state.error.message}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            {this.state.errorInfo?.componentStack?.split('\n').slice(0, 5).join('\n')}
          </div>
          <button
            onClick={() => this.setState({ error: null, errorInfo: null })}
            style={{
              marginTop: 12,
              padding: '4px 12px',
              background: '#fff',
              color: '#cc0000',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Dismiss and retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Export from index.ts**

Add to `tools/packages/ui-kit/src/index.ts`:

```typescript
export { ErrorBoundary } from "./ErrorBoundary";
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter @gseurat/ui-kit test
```
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tools/packages/ui-kit/src/ErrorBoundary.tsx tools/packages/ui-kit/src/index.ts
git commit -m "feat(ui-kit): add ErrorBoundary with visible error banner"
```

---

### Task 4: Integrate Registry into Bricklayer

**Files:**
- Create: `tools/apps/bricklayer/src/expected-components.json`
- Modify: `tools/apps/bricklayer/src/main.tsx`
- Modify: `tools/apps/bricklayer/src/App.tsx` — add useComponentRegistry to key panels

- [ ] **Step 1: Create Bricklayer manifest**

Create `tools/apps/bricklayer/src/expected-components.json`:

```json
{
  "always": ["MenuBar", "Viewport"],
  "modes": {
    "terrain": ["TerrainLeftPanel", "TerrainRightPanel"],
    "scene": ["ProjectTree", "ScenePropertiesPanel"],
    "settings": ["SettingsRightPanel"]
  },
  "conditional": {
    "CameraVolumeEditor": "when a camera volume is selected",
    "CameraRailEditor": "when a camera rail is selected",
    "CameraTriggerEditor": "when a camera trigger is selected",
    "ImportDialog": "when import dialog is open"
  }
}
```

- [ ] **Step 2: Wrap main.tsx with ErrorBoundary and init registry**

Modify `tools/apps/bricklayer/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary, componentRegistry } from '@gseurat/ui-kit';
import { registerTestStore } from '@gseurat/test-harness/register';
import { useSceneStore } from './store/useSceneStore.js';
import manifest from './expected-components.json';

if (import.meta.env.DEV) {
  registerTestStore(useSceneStore);
}

componentRegistry.setManifest(manifest);

// Sync mode with registry when store changes
useSceneStore.subscribe(
  (state) => state.mode,
  (mode) => componentRegistry.setMode(mode),
);
componentRegistry.setMode(useSceneStore.getState().mode);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

Note: The `subscribe` with selector requires zustand's `subscribeWithSelector` middleware. If Bricklayer's store doesn't have it, use the plain subscribe pattern instead:

```typescript
useSceneStore.subscribe((state) => {
  componentRegistry.setMode(state.mode);
});
```

- [ ] **Step 3: Add useComponentRegistry to key Bricklayer components**

Add `useComponentRegistry('<Name>')` as the first line inside each component function body:

**`tools/apps/bricklayer/src/App.tsx`** — in the `App` component, add registration for `MenuBar` and `Viewport` wrappers. Since App renders them inline, add the hook calls at the panel components themselves.

For each of these files, add at the top of the component function:
- `tools/apps/bricklayer/src/panels/MenuBar.tsx` → `useComponentRegistry('MenuBar')`
- `tools/apps/bricklayer/src/panels/TerrainLeftPanel.tsx` → `useComponentRegistry('TerrainLeftPanel')`
- `tools/apps/bricklayer/src/panels/TerrainRightPanel.tsx` → `useComponentRegistry('TerrainRightPanel')`
- `tools/apps/bricklayer/src/panels/ScenePropertiesPanel.tsx` → `useComponentRegistry('ScenePropertiesPanel')`
- `tools/apps/bricklayer/src/panels/SettingsRightPanel.tsx` → `useComponentRegistry('SettingsRightPanel')`
- `tools/apps/bricklayer/src/panels/CameraVolumeEditor.tsx` → `useComponentRegistry('CameraVolumeEditor')`
- `tools/apps/bricklayer/src/panels/CameraRailEditor.tsx` → `useComponentRegistry('CameraRailEditor')`
- `tools/apps/bricklayer/src/panels/CameraTriggerEditor.tsx` → `useComponentRegistry('CameraTriggerEditor')`
- `tools/apps/bricklayer/src/panels/ImportDialog.tsx` → `useComponentRegistry('ImportDialog')`

Each file needs this import added:
```typescript
import { useComponentRegistry } from '@gseurat/ui-kit';
```

And the Viewport component in R3F (likely `tools/apps/bricklayer/src/viewport/Viewport.tsx` or similar):
```typescript
useComponentRegistry('Viewport');
```

For the ProjectTree component (in scene mode):
```typescript
useComponentRegistry('ProjectTree');
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter bricklayer build
```
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/expected-components.json tools/apps/bricklayer/src/main.tsx tools/apps/bricklayer/src/panels/*.tsx tools/apps/bricklayer/src/viewport/
git commit -m "feat(bricklayer): integrate ComponentRegistry + ErrorBoundary"
```

---

### Task 5: Integrate Registry into Echidna and Méliès

**Files:**
- Create: `tools/apps/echidna/src/expected-components.json`
- Modify: `tools/apps/echidna/src/main.tsx`
- Create: `tools/apps/melies/src/expected-components.json`
- Modify: `tools/apps/melies/src/main.tsx`
- Modify: Key panel components in both apps (add `useComponentRegistry` calls)

- [ ] **Step 1: Explore Echidna and Méliès component trees**

Before creating manifests, explore the component trees of both apps:
- List panel components in `tools/apps/echidna/src/` (check for panels/, components/ directories)
- List panel components in `tools/apps/melies/src/`
- Identify mode/tab state in each app's store

This step is research — read files, identify component names and modes, then create accurate manifests.

- [ ] **Step 2: Create Echidna manifest**

Create `tools/apps/echidna/src/expected-components.json` with the components found in Step 1. Follow the same structure:

```json
{
  "always": ["MenuBar", "Viewport"],
  "modes": {},
  "conditional": {}
}
```

Fill in actual mode names and panel names discovered in Step 1.

- [ ] **Step 3: Wrap Echidna main.tsx with ErrorBoundary**

Modify `tools/apps/echidna/src/main.tsx` — wrap the `mount()` function's render call:

```tsx
import { ErrorBoundary, componentRegistry } from '@gseurat/ui-kit';
import manifest from './expected-components.json';

componentRegistry.setManifest(manifest);

function mount() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
```

Sync mode with store (same pattern as Bricklayer, using Echidna's store and mode field).

- [ ] **Step 4: Add useComponentRegistry to Echidna panels**

Same pattern as Task 4 Step 3 — add the hook to each panel component discovered in Step 1.

- [ ] **Step 5: Create Méliès manifest and integrate**

Same pattern — create manifest, wrap main.tsx, add hooks to panels.

- [ ] **Step 6: Verify both apps build**

Run:
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna build && pnpm --filter melies build
```
Expected: Both build with no errors

- [ ] **Step 7: Commit**

```bash
git add tools/apps/echidna/src/ tools/apps/melies/src/
git commit -m "feat(echidna,melies): integrate ComponentRegistry + ErrorBoundary"
```

---

### Task 6: Staging Visual State Struct

**Files:**
- Create: `include/gseurat/staging/visual_state.hpp`
- Create: `src/staging/visual_state.cpp`
- Create: `tests/test_visual_state.cpp`

- [ ] **Step 1: Write the failing test**

Create `tests/test_visual_state.cpp`:

```cpp
#include "gseurat/staging/visual_state.hpp"
#include <cstdio>
#include <cstring>
#include <nlohmann/json.hpp>

static int passed = 0, failed = 0;
static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else { std::printf("  FAIL: %s\n", msg); failed++; }
}

void test_panel_on_screen() {
    gseurat::PanelInfo p;
    p.name = "Render Settings";
    p.visible = true;
    p.pos_x = 1020; p.pos_y = 30;
    p.size_w = 250; p.size_h = 400;
    p.display_w = 1280; p.display_h = 720;

    check(p.is_on_screen(), "panel at 1020 fits in 1280 display");

    p.display_w = 1024;
    check(!p.is_on_screen(), "panel at 1020+250 exceeds 1024 display");

    p.pos_x = -300;
    check(!p.is_on_screen(), "panel fully off left edge");

    p.pos_x = 0; p.pos_y = -500;
    check(!p.is_on_screen(), "panel fully off top edge");
}

void test_visual_state_to_json() {
    gseurat::VisualState vs;
    vs.panels.push_back({"Info", true, 10, 30, 250, 120, 1280, 720});
    vs.gizmos.push_back({"lights", true, 3});
    vs.scene.gaussians_visible = 4521;
    vs.scene.gaussians_total = 12000;
    vs.scene.game_objects_loaded = 8;
    vs.scene.terrain_loaded = true;
    vs.scene.character_visible = true;
    vs.features["bloom"] = true;
    vs.features["dof"] = false;
    vs.camera_review.active = false;

    auto j = vs.to_json();

    check(j["panels"].is_array(), "panels is array");
    check(j["panels"][0]["name"] == "Info", "panel name serialized");
    check(j["panels"][0]["on_screen"] == true, "on_screen computed");
    check(j["gizmos"]["lights"]["enabled"] == true, "gizmo enabled");
    check(j["gizmos"]["lights"]["count"] == 3, "gizmo count");
    check(j["scene"]["gaussians_visible"] == 4521, "gaussian visible");
    check(j["features"]["bloom"] == true, "feature bloom");
    check(j["camera_review"]["active"] == false, "camera review inactive");
}

void test_visual_state_diff() {
    gseurat::VisualState a;
    a.scene.gaussians_total = 12000;
    a.scene.game_objects_loaded = 8;
    a.features["bloom"] = true;
    a.gizmos.push_back({"lights", true, 3});

    gseurat::VisualState b;
    b.scene.gaussians_total = 8000;  // changed
    b.scene.game_objects_loaded = 8;  // same
    b.features["bloom"] = false;      // changed
    b.gizmos.push_back({"lights", true, 5}); // count changed

    auto diff = gseurat::visual_state_diff(a.to_json(), b.to_json());

    check(diff.contains("changed"), "diff has changed section");
    // Flatten comparison — check that gaussians_total is flagged
    auto changed = diff["changed"];
    bool found_gaussians = false;
    for (auto& [k, v] : changed.items()) {
        if (k.find("gaussians_total") != std::string::npos) found_gaussians = true;
    }
    check(found_gaussians, "gaussians_total flagged as changed");
}

int main() {
    std::printf("=== test_visual_state ===\n");
    test_panel_on_screen();
    test_visual_state_to_json();
    test_visual_state_diff();
    std::printf("\n%d passed, %d failed\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
```

- [ ] **Step 2: Register test in CMakeLists.txt**

Add to `CMakeLists.txt` (follow the `add_gseurat_test` pattern):

```cmake
add_gseurat_test(test_visual_state tests/test_visual_state.cpp)
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cmake --build --preset macos-debug --target test_visual_state 2>&1 | tail -5
```
Expected: FAIL — `visual_state.hpp` not found

- [ ] **Step 4: Implement VisualState**

Create `include/gseurat/staging/visual_state.hpp`:

```cpp
#pragma once

#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include <unordered_map>

namespace gseurat {

struct PanelInfo {
    std::string name;
    bool visible = false;
    float pos_x = 0, pos_y = 0;
    float size_w = 0, size_h = 0;
    float display_w = 1280, display_h = 720;

    bool is_on_screen() const {
        return visible
            && (pos_x + size_w > 0) && (pos_x < display_w)
            && (pos_y + size_h > 0) && (pos_y < display_h);
    }
};

struct GizmoInfo {
    std::string name;
    bool enabled = false;
    int count = 0;
};

struct SceneInfo {
    int gaussians_visible = 0;
    int gaussians_total = 0;
    int game_objects_loaded = 0;
    bool terrain_loaded = false;
    bool character_visible = false;
};

struct CameraReviewInfo {
    bool active = false;
    float player_x = 0, player_y = 0, player_z = 0;
    std::string active_zone;
};

struct VisualState {
    std::vector<PanelInfo> panels;
    std::vector<GizmoInfo> gizmos;
    SceneInfo scene;
    std::unordered_map<std::string, bool> features;
    CameraReviewInfo camera_review;

    nlohmann::json to_json() const;
};

/// Compute flat diff between two visual_state JSONs.
nlohmann::json visual_state_diff(const nlohmann::json& before,
                                  const nlohmann::json& after);

} // namespace gseurat
```

Create `src/staging/visual_state.cpp`:

```cpp
#include "gseurat/staging/visual_state.hpp"

namespace gseurat {

nlohmann::json VisualState::to_json() const {
    nlohmann::json j;

    // Panels
    j["panels"] = nlohmann::json::array();
    for (auto& p : panels) {
        j["panels"].push_back({
            {"name", p.name},
            {"visible", p.visible},
            {"on_screen", p.is_on_screen()},
            {"pos", {p.pos_x, p.pos_y}},
            {"size", {p.size_w, p.size_h}},
        });
    }

    // Gizmos — keyed by name
    j["gizmos"] = nlohmann::json::object();
    for (auto& g : gizmos) {
        j["gizmos"][g.name] = {{"enabled", g.enabled}, {"count", g.count}};
    }

    // Scene
    j["scene"] = {
        {"gaussians_visible", scene.gaussians_visible},
        {"gaussians_total", scene.gaussians_total},
        {"game_objects_loaded", scene.game_objects_loaded},
        {"terrain_loaded", scene.terrain_loaded},
        {"character_visible", scene.character_visible},
    };

    // Features
    j["features"] = nlohmann::json::object();
    for (auto& [k, v] : features) {
        j["features"][k] = v;
    }

    // Camera review
    j["camera_review"] = {
        {"active", camera_review.active},
        {"player_pos", {camera_review.player_x, camera_review.player_y, camera_review.player_z}},
        {"active_zone", camera_review.active_zone},
    };

    return j;
}

// Flatten a JSON object to {"a.b.c": value} pairs
static void flatten(const nlohmann::json& j, const std::string& prefix,
                    std::unordered_map<std::string, nlohmann::json>& out) {
    if (j.is_object()) {
        for (auto& [k, v] : j.items()) {
            flatten(v, prefix.empty() ? k : prefix + "." + k, out);
        }
    } else if (j.is_array()) {
        for (size_t i = 0; i < j.size(); i++) {
            flatten(j[i], prefix + "[" + std::to_string(i) + "]", out);
        }
    } else {
        out[prefix] = j;
    }
}

nlohmann::json visual_state_diff(const nlohmann::json& before,
                                  const nlohmann::json& after) {
    std::unordered_map<std::string, nlohmann::json> flat_a, flat_b;
    flatten(before, "", flat_a);
    flatten(after, "", flat_b);

    nlohmann::json changed = nlohmann::json::object();
    nlohmann::json added = nlohmann::json::object();
    nlohmann::json removed = nlohmann::json::object();

    for (auto& [k, v] : flat_a) {
        auto it = flat_b.find(k);
        if (it == flat_b.end()) {
            removed[k] = {{"was", v}};
        } else if (it->second != v) {
            changed[k] = {{"was", v}, {"now", it->second}};
        }
    }
    for (auto& [k, v] : flat_b) {
        if (flat_a.find(k) == flat_a.end()) {
            added[k] = {{"now", v}};
        }
    }

    return {{"changed", changed}, {"added", added}, {"removed", removed}};
}

} // namespace gseurat
```

- [ ] **Step 5: Add source to CMakeLists.txt**

Add `src/staging/visual_state.cpp` to the `gseurat_core` OBJECT library source list in `CMakeLists.txt`.

- [ ] **Step 6: Run test to verify it passes**

Run:
```bash
cmake --build --preset macos-debug --target test_visual_state && cd build/macos-debug && ctest -R test_visual_state --output-on-failure
```
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add include/gseurat/staging/visual_state.hpp src/staging/visual_state.cpp tests/test_visual_state.cpp CMakeLists.txt
git commit -m "feat(staging): add VisualState struct with to_json and diff"
```

---

### Task 7: Register visual_state Command in Staging

**Files:**
- Modify: `src/staging/staging_state.cpp` — register `visual_state` command in `on_enter()`

- [ ] **Step 1: Add visual_state command handler**

In `src/staging/staging_state.cpp`, inside `StagingState::on_enter()` (where other commands like `camera_review` are registered), add:

```cpp
#include "gseurat/staging/visual_state.hpp"

// In on_enter(), after existing command registrations:
app.command_dispatcher().register_command("visual_state",
    [this, &app](const json& cmd) -> CommandResult {
        VisualState vs;

        // Display size
        auto& io = ImGui::GetIO();
        float dw = io.DisplaySize.x;
        float dh = io.DisplaySize.y;

        // Panels
        auto add_panel = [&](const char* name, bool visible) {
            auto* win = ImGui::FindWindowByName(name);
            if (win) {
                vs.panels.push_back({name, visible,
                    win->Pos.x, win->Pos.y,
                    win->Size.x, win->Size.y,
                    dw, dh});
            } else {
                vs.panels.push_back({name, visible, 0, 0, 0, 0, dw, dh});
            }
        };
        add_panel("Viewport Info", show_viewport_info_);
        add_panel("Render Settings", show_render_settings_);
        add_panel("GS Parameters", show_gs_params_);
        add_panel("Feature Toggles", show_feature_toggles_);
        add_panel("Lighting", show_lighting_);
        add_panel("Camera", show_camera_);
        add_panel("Performance", show_performance_);
        add_panel("Character", show_character_);

        // Gizmos — counts require iterating scene data
        auto count_if = [&](auto& vec) -> int { return static_cast<int>(vec.size()); };
        auto& sd = last_scene_data_;
        vs.gizmos.push_back({"lights", show_gizmo_lights_,
            sd ? static_cast<int>(sd->lights.size()) : 0});
        vs.gizmos.push_back({"emitters", show_gizmo_emitters_,
            sd ? static_cast<int>(sd->gs_emitters.size()) : 0});
        vs.gizmos.push_back({"vfx_instances", show_gizmo_vfx_,
            sd ? static_cast<int>(sd->vfx_instances.size()) : 0});
        vs.gizmos.push_back({"game_objects", show_gizmo_game_objects_,
            sd ? static_cast<int>(sd->game_objects.size()) : 0});
        vs.gizmos.push_back({"camera_zones", show_gizmo_camera_zones_,
            sd ? static_cast<int>(sd->camera_zones.volumes.size()) : 0});

        // Scene
        auto perf = app.gs_renderer().get_performance();
        vs.scene.gaussians_visible = perf.visible_count;
        vs.scene.gaussians_total = perf.gaussian_count;
        vs.scene.game_objects_loaded = sd ? static_cast<int>(sd->game_objects.size()) : 0;
        vs.scene.terrain_loaded = sd.has_value();
        vs.scene.character_visible = (character_data_ != nullptr);

        // Features
        for (auto& f : app.feature_flags().all()) {
            vs.features[f.name] = f.enabled;
        }

        // Camera review
        if (camera_review_) {
            vs.camera_review.active = true;
            auto pos = camera_review_->player_position();
            vs.camera_review.player_x = pos.x;
            vs.camera_review.player_y = pos.y;
            vs.camera_review.player_z = pos.z;
            vs.camera_review.active_zone = camera_review_->active_zone_name();
        }

        auto result = vs.to_json();
        result["type"] = "ok";
        return result;
    });
```

Note: The exact API for `get_performance()`, `feature_flags().all()`, and `camera_review_->active_zone_name()` should match the existing codebase. Check `gs_renderer.hpp` for the perf struct name and `feature_flags.hpp` for the iteration API. Adjust accessor names as needed.

- [ ] **Step 2: Build and verify**

Run:
```bash
cmake --build --preset macos-debug
```
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/staging/staging_state.cpp
git commit -m "feat(staging): register visual_state socket command"
```

---

### Task 8: Game Director — visual_state + snapshot Commands

**Files:**
- Modify: `scripts/game_director.py`

- [ ] **Step 1: Add visual_state function and CLI command**

Add to `scripts/game_director.py` after the existing command functions:

```python
def get_visual_state() -> dict:
    return send_command({"cmd": "visual_state"})


def snapshot_save(name: str) -> str:
    """Save current visual_state to /tmp/gseurat_snapshots/<name>.json."""
    import os
    vs = get_visual_state()
    snap_dir = "/tmp/gseurat_snapshots"
    os.makedirs(snap_dir, exist_ok=True)
    path = os.path.join(snap_dir, f"{name}.json")
    with open(path, "w") as f:
        json.dump(vs, f, indent=2)
    return path


def snapshot_diff(name: str) -> dict:
    """Compare current visual_state against saved snapshot."""
    snap_path = f"/tmp/gseurat_snapshots/{name}.json"
    if not os.path.exists(snap_path):
        return {"error": f"Snapshot '{name}' not found at {snap_path}"}
    with open(snap_path) as f:
        before = json.load(f)
    after = get_visual_state()

    # Flatten both and compare
    def flatten(obj, prefix=""):
        out = {}
        if isinstance(obj, dict):
            for k, v in obj.items():
                flatten(v, f"{prefix}.{k}" if prefix else k).items()
                out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                out.update(flatten(v, f"{prefix}[{i}]"))
        else:
            out[prefix] = obj
        return out

    flat_a = flatten(before)
    flat_b = flatten(after)

    changed = {}
    added = {}
    removed = {}

    for k, v in flat_a.items():
        if k not in flat_b:
            removed[k] = {"was": v}
        elif flat_b[k] != v:
            changed[k] = {"was": v, "now": flat_b[k]}

    for k, v in flat_b.items():
        if k not in flat_a:
            added[k] = {"now": v}

    return {"changed": changed, "added": added, "removed": removed}


def snapshot_list() -> list:
    """List saved snapshot names."""
    snap_dir = "/tmp/gseurat_snapshots"
    if not os.path.isdir(snap_dir):
        return []
    return [f.replace(".json", "") for f in os.listdir(snap_dir) if f.endswith(".json")]
```

Add CLI dispatch in the `main()` function's elif chain:

```python
        elif cmd == "visual_state":
            vs = get_visual_state()
            # Print summary
            panels = vs.get("panels", [])
            off_screen = [p for p in panels if p.get("visible") and not p.get("on_screen")]
            print(f"Panels: {len(panels)} total, {len(off_screen)} off-screen")
            for p in off_screen:
                print(f"  WARNING: '{p['name']}' is visible but off-screen at ({p['pos'][0]:.0f}, {p['pos'][1]:.0f})")
            gizmos = vs.get("gizmos", {})
            for name, g in gizmos.items():
                status = "ON" if g.get("enabled") else "off"
                print(f"  Gizmo {name}: [{status}] count={g.get('count', 0)}")
            scene = vs.get("scene", {})
            print(f"  Gaussians: {scene.get('gaussians_visible', 0)}/{scene.get('gaussians_total', 0)}")
            print(f"  Game objects: {scene.get('game_objects_loaded', 0)}")
            cr = vs.get("camera_review", {})
            if cr.get("active"):
                print(f"  Camera review: active, zone={cr.get('active_zone')}")

        elif cmd == "snapshot":
            if len(sys.argv) < 3:
                print("Usage: game_director.py snapshot <save|diff|list> [name]")
                return
            sub = sys.argv[2]
            if sub == "save":
                if len(sys.argv) < 4:
                    print("Usage: game_director.py snapshot save <name>")
                    return
                path = snapshot_save(sys.argv[3])
                print(f"Snapshot saved: {path}")
            elif sub == "diff":
                if len(sys.argv) < 4:
                    print("Usage: game_director.py snapshot diff <name>")
                    return
                diff = snapshot_diff(sys.argv[3])
                if "error" in diff:
                    print(f"Error: {diff['error']}")
                else:
                    changed = diff.get("changed", {})
                    added = diff.get("added", {})
                    removed = diff.get("removed", {})
                    if not changed and not added and not removed:
                        print("No differences")
                    else:
                        if changed:
                            print("Changed:")
                            for k, v in sorted(changed.items()):
                                print(f"  {k}: {v['was']} → {v['now']}")
                        if added:
                            print("Added:")
                            for k, v in sorted(added.items()):
                                print(f"  {k}: {v['now']}")
                        if removed:
                            print("Removed:")
                            for k, v in sorted(removed.items()):
                                print(f"  {k}: was {v['was']}")
            elif sub == "list":
                snaps = snapshot_list()
                if snaps:
                    for s in sorted(snaps):
                        print(f"  {s}")
                else:
                    print("No snapshots saved")
```

- [ ] **Step 2: Update docstring**

Add to the script docstring at the top:

```python
"""Game Director — automated playtesting via the GSeurat control server.

...existing lines...
  python scripts/game_director.py visual_state
  python scripts/game_director.py snapshot save <name>
  python scripts/game_director.py snapshot diff <name>
  python scripts/game_director.py snapshot list
"""
```

- [ ] **Step 3: Commit**

```bash
git add scripts/game_director.py
git commit -m "feat(game-director): add visual_state and snapshot save/diff commands"
```

---

### Task 9: Scenario Runner — Base Framework + First Scenario

**Files:**
- Create: `scripts/scenario_runner.py`

- [ ] **Step 1: Create scenario runner framework**

Create `scripts/scenario_runner.py`:

```python
#!/usr/bin/env python3
"""Scenario Runner — end-to-end user workflow tests for GSeurat tools.

Chains browser automation (Chrome MCP) and Game Director socket commands
into role-specific test scenarios.

Usage:
  python scripts/scenario_runner.py --list
  python scripts/scenario_runner.py --role level-designer
  python scripts/scenario_runner.py --role model-designer
  python scripts/scenario_runner.py --scenario staging_panels
  python scripts/scenario_runner.py --all
"""

import argparse
import json
import os
import sys
import time
import traceback

# Import Game Director for socket communication
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_director as gd


class ScenarioResult:
    def __init__(self, name: str):
        self.name = name
        self.steps: list[tuple[str, bool, str, float]] = []  # (description, passed, detail, elapsed)

    def step(self, description: str, passed: bool, detail: str = "", elapsed: float = 0.0):
        self.steps.append((description, passed, detail, elapsed))
        status = "PASS" if passed else "FAIL"
        msg = f"  {status}  {description}"
        if detail:
            msg += f" — {detail}"
        if elapsed > 0:
            msg += f" ({elapsed:.1f}s)"
        print(msg)

    @property
    def passed(self) -> bool:
        return all(s[1] for s in self.steps)

    def summary(self) -> str:
        p = sum(1 for s in self.steps if s[1])
        return f"{'PASS' if self.passed else 'FAIL'} ({p}/{len(self.steps)} steps)"


# ── Scenario Registry ──

SCENARIOS: dict[str, dict] = {}  # name -> {"role": str, "fn": callable, "description": str}


def scenario(name: str, role: str, description: str):
    """Decorator to register a scenario."""
    def decorator(fn):
        SCENARIOS[name] = {"role": role, "fn": fn, "description": description}
        return fn
    return decorator


# ── Level Designer Scenarios ──

@scenario("staging_panels", "level-designer",
          "Launch Staging, verify all panels are on-screen via visual_state")
def scenario_staging_panels() -> ScenarioResult:
    result = ScenarioResult("staging_panels")

    # Step 1: Connect to Staging
    t0 = time.time()
    try:
        gd._conn = gd.GameConnection()
        gd._conn.connect()
        result.step("Connected to Staging", True, elapsed=time.time() - t0)
    except Exception as e:
        result.step("Connected to Staging", False, str(e))
        return result

    # Step 2: Get visual state
    t0 = time.time()
    try:
        vs = gd.get_visual_state()
        result.step("Got visual_state", vs.get("type") == "ok",
                     detail=f"{len(vs.get('panels', []))} panels",
                     elapsed=time.time() - t0)
    except Exception as e:
        result.step("Got visual_state", False, str(e))
        return result

    # Step 3: Check all visible panels are on-screen
    panels = vs.get("panels", [])
    off_screen = [p for p in panels if p.get("visible") and not p.get("on_screen")]
    if off_screen:
        names = ", ".join(p["name"] for p in off_screen)
        result.step("All visible panels on-screen", False, f"Off-screen: {names}")
    else:
        visible_count = sum(1 for p in panels if p.get("visible"))
        result.step("All visible panels on-screen", True, f"{visible_count} visible")

    # Step 4: Check gizmo state
    gizmos = vs.get("gizmos", {})
    result.step("Gizmo state reported", len(gizmos) > 0,
                f"{len(gizmos)} gizmo types")

    # Step 5: Check scene state
    scene = vs.get("scene", {})
    has_scene = scene.get("terrain_loaded", False) or scene.get("gaussians_total", 0) > 0
    result.step("Scene state reported", True,
                f"terrain={'yes' if scene.get('terrain_loaded') else 'no'}, "
                f"gaussians={scene.get('gaussians_total', 0)}")

    gd._conn.close()
    return result


@scenario("staging_snapshot", "level-designer",
          "Take snapshot, verify diff reports no changes when nothing changes")
def scenario_staging_snapshot() -> ScenarioResult:
    result = ScenarioResult("staging_snapshot")

    try:
        gd._conn = gd.GameConnection()
        gd._conn.connect()
        result.step("Connected to Staging", True)
    except Exception as e:
        result.step("Connected to Staging", False, str(e))
        return result

    # Save snapshot
    path = gd.snapshot_save("_scenario_test")
    result.step("Snapshot saved", os.path.exists(path), path)

    # Diff immediately — should be no changes
    time.sleep(0.1)
    diff = gd.snapshot_diff("_scenario_test")
    changed = diff.get("changed", {})
    # Filter out volatile fields (fps, frame timing)
    stable_changes = {k: v for k, v in changed.items()
                      if "fps" not in k and "frame_time" not in k and "anim_time" not in k}
    result.step("No unexpected changes in snapshot diff",
                len(stable_changes) == 0,
                f"{len(stable_changes)} changed" if stable_changes else "clean")

    # Cleanup
    try:
        os.remove(path)
    except OSError:
        pass

    gd._conn.close()
    return result


# ── Runner ──

def run_scenarios(names: list[str]) -> bool:
    print()
    all_passed = True
    for name in names:
        entry = SCENARIOS.get(name)
        if not entry:
            print(f"Unknown scenario: {name}")
            all_passed = False
            continue
        print(f"--- Scenario: {name} ---")
        print(f"    {entry['description']}")
        try:
            result = entry["fn"]()
        except Exception as e:
            print(f"  FAIL  Scenario crashed: {e}")
            traceback.print_exc()
            result = ScenarioResult(name)
            result.step("Scenario execution", False, str(e))
        print(f"RESULT: {result.summary()}")
        print()
        if not result.passed:
            all_passed = False
    return all_passed


def main():
    parser = argparse.ArgumentParser(description="GSeurat Scenario Runner")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--role", type=str, help="Run all scenarios for a role")
    parser.add_argument("--scenario", type=str, help="Run a specific scenario")
    parser.add_argument("--all", action="store_true", help="Run all scenarios")
    args = parser.parse_args()

    if args.list:
        roles = {}
        for name, entry in sorted(SCENARIOS.items()):
            roles.setdefault(entry["role"], []).append((name, entry["description"]))
        for role, scenarios in sorted(roles.items()):
            print(f"\n=== {role} ===")
            for name, desc in scenarios:
                print(f"  {name:30s}  {desc}")
        return

    if args.scenario:
        success = run_scenarios([args.scenario])
    elif args.role:
        names = [n for n, e in SCENARIOS.items() if e["role"] == args.role]
        if not names:
            print(f"No scenarios for role: {args.role}")
            return
        print(f"=== Role: {args.role} ({len(names)} scenarios) ===")
        success = run_scenarios(names)
    elif args.all:
        print(f"=== All scenarios ({len(SCENARIOS)} total) ===")
        success = run_scenarios(list(SCENARIOS.keys()))
    else:
        parser.print_help()
        return

    total = len(SCENARIOS) if args.all else (len([n for n, e in SCENARIOS.items() if e["role"] == args.role]) if args.role else 1)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Make executable**

Run:
```bash
chmod +x /Users/eccyan/dev/GSeurat/scripts/scenario_runner.py
```

- [ ] **Step 3: Verify list command works**

Run:
```bash
python3 scripts/scenario_runner.py --list
```
Expected output listing scenarios grouped by role.

- [ ] **Step 4: Commit**

```bash
git add scripts/scenario_runner.py
git commit -m "feat: add scenario runner with staging_panels and staging_snapshot scenarios"
```

---

### Task 10: Role-Specific Claude Code Skills

**Files:**
- Create: `~/.claude/skills/level-designer/SKILL.md`
- Create: `~/.claude/skills/vfx-designer/SKILL.md`
- Create: `~/.claude/skills/sound-designer/SKILL.md`
- Modify: `~/.claude/skills/model-designer/SKILL.md` — add verification section
- Modify: `~/.claude/skills/game-director/SKILL.md` — scope down

- [ ] **Step 1: Create Level Designer skill**

Create `~/.claude/skills/level-designer/SKILL.md`:

```markdown
---
name: level-designer
description: Use when authoring scenes in Bricklayer (terrain, game objects, camera zones, lighting) and reviewing in Staging. Also use when the user asks to "design a level", "edit a scene", "set up cameras", or "add lighting".
---

# Level Designer

Automates the Bricklayer (port 5180) and Staging scene authoring workflow. Uses browser automation for Bricklayer UI, Game Director socket commands for Staging verification.

## When to Use

- User asks to create or edit a scene/level
- User wants to set up camera zones, rails, or triggers
- User wants to add/configure game objects, lighting, or terrain
- User wants to review a scene in Staging
- After implementing any Bricklayer UI feature

## Prerequisites

- Bricklayer running: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter bricklayer dev` (port 5180)
- For Staging review: `cmake --build --preset macos-debug && cd build/macos-debug && ./gseurat_staging &`
- Chrome browser with Claude-in-Chrome extension active

## Setup

**1. Start Bricklayer:**
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter bricklayer dev &
```

**2. Open in browser:**
Use `mcp__claude-in-chrome__tabs_create_mcp` to open `http://localhost:5180`

**3. Verify loaded — Component Registry health check:**
```javascript
JSON.stringify(window.__COMPONENT_REGISTRY__.health())
```
Expected: `missing: []`, `errors: []`

## Core Strategy

1. Use `javascript_tool` with Zustand store (`window.__ZUSTAND_STORE__`) for data operations
2. Use Component Registry health check after any UI change
3. Use screenshots for visual verification
4. Use browser clicks for menu operations and mode switching

## Store Access

```javascript
const store = window.__ZUSTAND_STORE__;
// Read state
JSON.stringify(store.getState().mode)
// Set mode
store.getState().setMode('scene')
// Add camera volume
store.getState().addCameraVolume()
// Get all volumes
JSON.stringify(store.getState().cameraVolumes)
```

## Workflows

### Scene Composition
1. Switch to Scene mode: `store.getState().setMode('scene')`
2. Add game objects via store
3. Configure PLY files, positions, PBD physics
4. Verify Component Registry — ScenePropertiesPanel should be mounted

### Camera System
1. Switch to Scene mode
2. Add volumes: `store.getState().addCameraVolume()`
3. Add rails: `store.getState().addCameraRail()`
4. Add triggers: `store.getState().addCameraTrigger()`
5. Configure params in the inspector panel
6. Verify: CameraVolumeEditor/CameraRailEditor/CameraTriggerEditor mounted

### Send to Staging
1. Click File menu → "Open in Staging"
2. Wait 2 seconds for socket transfer
3. Verify with Game Director:
   ```bash
   python3 scripts/game_director.py visual_state
   ```
4. Check camera zones, game objects, lights match Bricklayer counts

### Staging Camera Review
1. Activate: `python3 scripts/game_director.py camera_review on`
2. Walk: `python3 scripts/game_director.py camera_review_walk forward 2`
3. Check status: `python3 scripts/game_director.py camera_review status`
4. Screenshot: `python3 scripts/game_director.py screenshot`

## Verification Checklist

After any Bricklayer UI change:
1. Run Component Registry health check — no missing, no errors
2. Read browser console — no React errors
3. If cross-app: run `python3 scripts/scenario_runner.py --role level-designer`
4. If Staging UI change: run `python3 scripts/game_director.py visual_state` — all panels on_screen

## Handoff

- **To Game Director**: After scene is complete, playtest with `python3 scripts/game_director.py tour`
- **From Model Designer**: Character PLYs are in `assets/characters/`
- **From VFX Designer**: VFX scenes are in `assets/vfx/`
```

- [ ] **Step 2: Create VFX Designer skill**

Create `~/.claude/skills/vfx-designer/SKILL.md`:

```markdown
---
name: vfx-designer
description: Use when creating or editing VFX in Méliès (particle effects, emitter regions, animation regions). Also use when the user asks to "create VFX", "edit particles", "design effects", or "open melies".
---

# VFX Designer

Automates the Méliès VFX editor (port 5181) workflow. Uses browser automation for UI, Game Director for Staging verification.

## When to Use

- User asks to create or edit VFX/particle effects
- User wants to configure emitter or animation regions
- User wants to preview VFX in Staging
- After implementing any Méliès UI feature

## Prerequisites

- Méliès running: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies dev` (port 5181)
- Chrome browser with Claude-in-Chrome extension active

## Setup

**1. Start Méliès:**
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies dev &
```

**2. Open in browser:**
Use `mcp__claude-in-chrome__tabs_create_mcp` to open `http://localhost:5181`

**3. Verify loaded — Component Registry health check:**
```javascript
JSON.stringify(window.__COMPONENT_REGISTRY__.health())
```

## Workflows

### Create Emitter
1. Navigate to emitter panel
2. Configure spawn shape (sphere/box), rate, lifetime
3. Set particle colors, size, velocity
4. Verify Component Registry — emitter editor mounted

### VFX to Staging
1. Export VFX scene
2. Open in Staging: verify via `visual_state` that vfx_instances count matches

## Verification Checklist

After any Méliès UI change:
1. Component Registry health check — no missing, no errors
2. Read browser console — no React errors
3. Run `python3 scripts/scenario_runner.py --role vfx-designer`

## Handoff

- **To Level Designer**: VFX scenes placed in Bricklayer scene composition
```

- [ ] **Step 3: Create Sound Designer skill**

Create `~/.claude/skills/sound-designer/SKILL.md`:

```markdown
---
name: sound-designer
description: Use when creating or editing audio in Audio Composer (music, SFX, audio triggers). Also use when the user asks to "create music", "design sound effects", "compose audio", or "open audio composer".
---

# Sound Designer

Automates the Audio Composer workflow for music and SFX creation.

## When to Use

- User asks to create or edit music or sound effects
- User wants to configure audio triggers
- After implementing any Audio Composer UI feature

## Prerequisites

- Audio Composer running (check port in tools/apps/)
- Chrome browser with Claude-in-Chrome extension active

## Setup

Start the Audio Composer dev server and open in browser. Verify with Component Registry health check.

## Workflows

### Create SFX
1. Open Audio Composer
2. Configure waveform, envelope, filters
3. Preview and export
4. Verify Component Registry — relevant editors mounted

### Audio Triggers
1. Configure trigger parameters (proximity, event-based)
2. Export audio asset
3. Reference in scene JSON

## Verification Checklist

After any Audio Composer UI change:
1. Component Registry health check — no missing, no errors
2. Read browser console — no React errors
3. Run `python3 scripts/scenario_runner.py --role sound-designer`

## Handoff

- **To Level Designer**: Audio assets referenced in Bricklayer scene composition
```

- [ ] **Step 4: Add verification section to Model Designer skill**

Append to `~/.claude/skills/model-designer/SKILL.md`, before any closing section:

```markdown
## Animation Workflow

The Model Designer also handles character animation (pose authoring, clip creation):

1. Switch to Animate mode in Echidna
2. Create keyframes with pose data
3. Set clip timing and transitions
4. Export animation data in character manifest

## Verification Checklist

After any Echidna UI change:
1. Component Registry health check:
   ```javascript
   JSON.stringify(window.__COMPONENT_REGISTRY__.health())
   ```
   Expected: no missing components, no errors
2. Read browser console — no React errors
3. Run `python3 scripts/scenario_runner.py --role model-designer`
4. If exporting PLY: verify file exists and has expected vertex count

## Handoff

- **To Level Designer**: Character PLYs + manifests in `assets/characters/`
- **To Game Director**: Character animation tested via demo playtest
```

- [ ] **Step 5: Scope down Game Director skill**

Replace the "When to Use" section of `~/.claude/skills/game-director/SKILL.md` to clarify it's demo-only:

Add near the top, after the description:

```markdown
## Scope

Game Director is for **demo app playtesting only**. For creative tool workflows, use the role-specific skills:
- **Level Designer** — Bricklayer + Staging scene authoring
- **Model Designer** — Echidna character creation and animation
- **VFX Designer** — Méliès VFX editing
- **Sound Designer** — Audio Composer

Game Director commands (walk, screenshot, perf, triggers, tour, playtest) work with the demo app. The `visual_state` and `snapshot` commands work with Staging.
```

- [ ] **Step 6: Commit**

```bash
git add ~/.claude/skills/level-designer/SKILL.md ~/.claude/skills/vfx-designer/SKILL.md ~/.claude/skills/sound-designer/SKILL.md ~/.claude/skills/model-designer/SKILL.md ~/.claude/skills/game-director/SKILL.md
git commit -m "feat: add role-specific skills (level-designer, vfx-designer, sound-designer) and scope down game-director"
```

---

### Task 11: CLAUDE.md UI Implementation Checklist

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Check if CLAUDE.md exists**

Run:
```bash
ls -la /Users/eccyan/dev/GSeurat/CLAUDE.md 2>/dev/null || echo "does not exist"
```

- [ ] **Step 2: Add checklist section**

If CLAUDE.md exists, append the checklist. If not, create it. Add:

```markdown
## UI Implementation Checklist

After creating or modifying any UI component, verify ALL of the following before marking the task complete:

### React (Bricklayer / Echidna / Méliès)
1. New component is imported in its parent
2. New component is rendered in JSX (not just imported)
3. Component is listed in `expected-components.json` for the relevant app/mode
4. Build succeeds (`pnpm build` in tools/)
5. Run component registry health check via Chrome MCP — no missing components:
   ```javascript
   JSON.stringify(window.__COMPONENT_REGISTRY__.health())
   ```
6. Read browser console — no React errors
7. Run role-specific scenarios: `python3 scripts/scenario_runner.py --role <role>`

### Staging (C++ ImGui)
1. New panel/widget has a draw call in `staging_state.cpp`
2. Panel is registered in the View menu toggle
3. Build succeeds (`cmake --build --preset macos-debug`)
4. Run `visual_state` via Game Director — new element appears:
   ```bash
   python3 scripts/game_director.py visual_state
   ```
5. Run snapshot diff — only intended changes present:
   ```bash
   python3 scripts/game_director.py snapshot save before
   # ... make change ...
   python3 scripts/game_director.py snapshot diff before
   ```

### Cross-App (Bricklayer to Staging)
1. Data created in Bricklayer reaches Staging via "Open in Staging"
2. Run relevant role scenario: `python3 scripts/scenario_runner.py --role level-designer`
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add UI Implementation Checklist to CLAUDE.md"
```

---

### Task 12: CI Integration — Add ui-kit Tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add ui-kit test to CI test-tools job**

Add to the test-tools job's test commands:

```yaml
- run: pnpm --filter @gseurat/ui-kit test
```

- [ ] **Step 2: Add test_visual_state to C++ test job**

The `add_gseurat_test` macro should automatically include it in CTest. Verify by checking:

```bash
cmake --build --preset macos-debug && cd build/macos-debug && ctest -N | grep visual_state
```

Expected: `test_visual_state` appears in test list.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add ui-kit and visual_state tests"
```
