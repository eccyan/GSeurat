# ColliderComponent Editor in Bricklayer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom ColliderEditor panel to Bricklayer so level designers can edit primitive colliders (Box, Sphere, Capsule) on game objects without raw JSON.

**Architecture:** A bespoke `ColliderEditor.tsx` component renders shape-type-conditional fields with input validation (min 0.01). It replaces the generic `ComponentEditor` for `ColliderComponent` entries in `GameObjectProperties.tsx`. Data flows through existing game object store → 2s debounced auto-sync → engine.

**Tech Stack:** React, TypeScript, Zustand (useSceneStore), @gseurat/ui-kit (NumberInput, Vec3Input)

---

### Task 1: Create ColliderEditor component

**Files:**
- Create: `tools/apps/bricklayer/src/panels/editors/ColliderEditor.tsx`

- [ ] **Step 1: Create ColliderEditor.tsx**

```tsx
import React from 'react';
import { NumberInput } from '../../components/NumberInput.js';
import { Vec3Input } from '../../components/Vec3Input.js';
import { panelStyles } from '../../styles/panel.js';

const styles = { ...panelStyles };

interface ColliderEditorProps {
  data: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  onRemove: () => void;
}

const DEFAULT_SHAPES: Record<string, unknown> = {
  box: { type: 'box', half_extents: [0.5, 0.5, 0.5] },
  sphere: { type: 'sphere', radius: 0.5 },
  capsule: { type: 'capsule', radius: 0.3, half_height: 0.5 },
};

export function ColliderEditor({ data, onChange, onRemove }: ColliderEditorProps) {
  const shape = data.shape as Record<string, unknown> | undefined;
  const shapeType = (shape?.type as string) ?? 'box';

  const updateShape = (patch: Record<string, unknown>) => {
    onChange('shape', { ...shape, ...patch });
  };

  return (
    <div style={{ border: '1px solid #333', borderRadius: 4, marginBottom: 8, background: '#1a1a2e' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          borderBottom: '1px solid #333',
        }}
      >
        <span style={{ fontSize: 12, color: '#ccc', flex: 1 }}>ColliderComponent</span>
        <button
          style={{
            padding: '0 4px', border: 'none', background: 'transparent',
            color: '#844', cursor: 'pointer', fontSize: 13, lineHeight: '1',
          }}
          onClick={onRemove}
        >&times;</button>
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={styles.section}>
          <span style={styles.label}>Shape</span>
          <select
            style={styles.select}
            value={shapeType}
            onChange={(e) => onChange('shape', DEFAULT_SHAPES[e.target.value])}
          >
            <option value="box">Box</option>
            <option value="sphere">Sphere</option>
            <option value="capsule">Capsule</option>
          </select>
        </div>

        {shapeType === 'box' && (
          <div style={styles.section}>
            <span style={styles.label}>Half Extents</span>
            <Vec3Input
              value={(shape?.half_extents as [number, number, number]) ?? [0.5, 0.5, 0.5]}
              onChange={(v) => updateShape({ half_extents: v.map((c) => Math.max(0.01, c)) })}
            />
          </div>
        )}

        {(shapeType === 'sphere' || shapeType === 'capsule') && (
          <div style={styles.section}>
            <span style={styles.label}>Radius</span>
            <NumberInput
              value={(shape?.radius as number) ?? 0.5}
              min={0.01}
              step={0.1}
              onChange={(v) => updateShape({ radius: v })}
              style={styles.input}
            />
          </div>
        )}

        {shapeType === 'capsule' && (
          <div style={styles.section}>
            <span style={styles.label}>Half Height</span>
            <NumberInput
              value={(shape?.half_height as number) ?? 0.5}
              min={0.01}
              step={0.1}
              onChange={(v) => updateShape({ half_height: v })}
              style={styles.input}
            />
          </div>
        )}

        <div style={styles.section}>
          <span style={styles.label}>Offset</span>
          <Vec3Input
            value={(data.offset as [number, number, number]) ?? [0, 0, 0]}
            onChange={(v) => onChange('offset', v)}
          />
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={(data.is_trigger as boolean) ?? false}
              onChange={(e) => onChange('is_trigger', e.target.checked)}
            />
            Is Trigger
          </label>
        </div>

        <div style={styles.section}>
          <label style={{ fontSize: 12, color: '#ddd', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={(data.is_dynamic as boolean) ?? false}
              onChange={(e) => onChange('is_dynamic', e.target.checked)}
            />
            Is Dynamic
          </label>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: Only the pre-existing simulation-wasm error (no new errors).

- [ ] **Step 3: Commit**

```bash
git add tools/apps/bricklayer/src/panels/editors/ColliderEditor.tsx
git commit -m "feat(bricklayer): add ColliderEditor component with shape-conditional fields"
```

---

### Task 2: Export ColliderEditor from editors index

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/editors/index.ts`

- [ ] **Step 1: Add export**

Add this line after the existing `ComponentEditor` export:

```typescript
export { ColliderEditor } from './ColliderEditor.js';
```

- [ ] **Step 2: Commit**

```bash
git add tools/apps/bricklayer/src/panels/editors/index.ts
git commit -m "chore(bricklayer): export ColliderEditor from editors index"
```

---

### Task 3: Wire ColliderEditor into GameObjectProperties

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/editors/GameObjectProperties.tsx`

- [ ] **Step 1: Add import**

At the top of the file, add the ColliderEditor import alongside the existing ComponentEditor import:

```typescript
import { ColliderEditor } from './ColliderEditor.js';
```

- [ ] **Step 2: Add special-case rendering for ColliderComponent**

In the component rendering loop (the `attachedNames.map` block starting at line 221), replace the current body with a check for ColliderComponent before falling through to the generic ComponentEditor:

Replace lines 221-249:
```tsx
        {attachedNames.map((name) => {
          const schema = componentSchemas.find((s) => s.name === name);
          if (!schema) {
            return (
              <div key={name} style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                {name} (no schema)
              </div>
            );
          }
          return (
            <ComponentEditor
              key={name}
              schema={schema}
              data={obj.components[name]}
              onChange={(field, value) => {
                update(obj.id, {
                  components: {
                    ...obj.components,
                    [name]: { ...obj.components[name], [field]: value },
                  },
                });
              }}
              onRemove={() => {
                const { [name]: _, ...rest } = obj.components;
                update(obj.id, { components: rest });
              }}
            />
          );
        })}
```

With:
```tsx
        {attachedNames.map((name) => {
          const componentOnChange = (field: string, value: unknown) => {
            update(obj.id, {
              components: {
                ...obj.components,
                [name]: { ...obj.components[name], [field]: value },
              },
            });
          };
          const componentOnRemove = () => {
            const { [name]: _, ...rest } = obj.components;
            update(obj.id, { components: rest });
          };

          if (name === 'ColliderComponent') {
            return (
              <ColliderEditor
                key={name}
                data={obj.components[name]}
                onChange={componentOnChange}
                onRemove={componentOnRemove}
              />
            );
          }

          const schema = componentSchemas.find((s) => s.name === name);
          if (!schema) {
            return (
              <div key={name} style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                {name} (no schema)
              </div>
            );
          }
          return (
            <ComponentEditor
              key={name}
              schema={schema}
              data={obj.components[name]}
              onChange={componentOnChange}
              onRemove={componentOnRemove}
            />
          );
        })}
```

- [ ] **Step 3: Verify the file compiles**

Run: `cd tools && pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: Only the pre-existing simulation-wasm error (no new errors).

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/editors/GameObjectProperties.tsx
git commit -m "feat(bricklayer): wire ColliderEditor into GameObjectProperties"
```

---

### Task 4: Verify end-to-end data flow

- [ ] **Step 1: Verify scene export includes collider data**

Check that `exportSceneJson()` already exports `components.ColliderComponent` for game objects. Search the export function:

```bash
cd tools && grep -n 'components' apps/bricklayer/src/lib/sceneExport.ts | head -10
```

Expected: Game object export spreads `obj.components` into the output JSON (collider data flows through unchanged).

- [ ] **Step 2: Verify bridge auto-sync carries the data**

Check that the auto-sync in MenuBar.tsx sends full scene JSON including game objects:

```bash
grep -n 'load_scene_json\|update_scene_data' apps/bricklayer/src/panels/MenuBar.tsx | head -5
```

Expected: Both `load_scene_json` and `update_scene_data` commands are sent with the full exported scene JSON.

- [ ] **Step 3: Final type-check**

Run: `pnpm --filter bricklayer exec tsc --noEmit 2>&1 | grep -v simulation-wasm | grep -v ERR_PNPM | grep -v undefined | grep -v '^$'`

Expected: No new errors.

- [ ] **Step 4: Commit (no-op — verification only)**

No files changed. If all checks pass, the feature is complete.
