# Phase 2: Unified Navigation Tree + Context Switching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-mode tab bar (WORLD/TERRAIN/SCENE/SETTINGS) with a 2-mode system (WORLD/SCENE), extend WorldTree with Instances and Portals, add property editors for new world entities, and wire up context switching between chunks/instances.

**Architecture:** The tab bar shrinks to 2 modes. TERRAIN tools and SETTINGS panels fold into SCENE mode — they're still accessible via the ProjectTree's node click handler. WorldTree gains Instances and Portals sections. WorldPropertiesPanel gains Instance/Portal editors. Context switching prompts to save dirty state before loading a different scene.

**Tech Stack:** TypeScript, React, Zustand

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `tools/apps/bricklayer/src/store/types.ts` | Modify | Change `BricklayerMode` to `'world' \| 'scene'` |
| `tools/apps/bricklayer/src/App.tsx` | Modify | 2-tab bar, unified left/right panel routing for SCENE mode |
| `tools/apps/bricklayer/src/panels/WorldTree.tsx` | Modify | Add Instances and Portals sections |
| `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx` | Modify | Add InstanceEditor and PortalEditor components |
| `tools/apps/bricklayer/src/panels/ProjectTree.tsx` | Modify | Remove redundant mode-switch logic (terrain/settings modes gone) |

---

### Task 1: Reduce BricklayerMode to 2 Modes

**Files:**
- Modify: `tools/apps/bricklayer/src/store/types.ts`
- Modify: `tools/apps/bricklayer/src/App.tsx`

- [ ] **Step 1: Update BricklayerMode type**

In `tools/apps/bricklayer/src/store/types.ts`, change:

```typescript
// OLD:
export type BricklayerMode = 'terrain' | 'scene' | 'settings' | 'world';

// NEW:
export type BricklayerMode = 'world' | 'scene';
```

- [ ] **Step 2: Update tab bar in App.tsx**

In `App.tsx`, change the `modeTabs` array (around line 519):

```typescript
// OLD:
const modeTabs: { key: string; label: string }[] = [
  { key: 'world', label: 'WORLD' },
  { key: 'terrain', label: 'TERRAIN' },
  { key: 'scene', label: 'SCENE' },
  { key: 'settings', label: 'SETTINGS' },
];

// NEW:
const modeTabs: { key: string; label: string }[] = [
  { key: 'world', label: 'WORLD' },
  { key: 'scene', label: 'SCENE' },
];
```

- [ ] **Step 3: Update left panel rendering in App.tsx**

The left panel currently shows `WorldTree` in world mode, and `ProjectTree` + terrain tools in other modes. Since terrain and settings are now sub-states of 'scene', simplify:

```typescript
// Around line 546-563, replace the left panel content:
<div style={{ ...styles.leftPanel, width: leftWidth }}>
  {isWorldMode ? (
    <div style={{ ...styles.leftContent, padding: 8 }}>
      <WorldTree />
    </div>
  ) : (
    <>
      {/* Project tree at top */}
      <div style={styles.leftTop}>
        <ProjectTree />
      </div>
      {/* Contextual tools below */}
      <div style={styles.leftContent}>
        {showTerrainTools && <TerrainLeftPanel />}
        {showCollisionTools && <CollisionLeftPanel />}
      </div>
    </>
  )}
</div>
```

This stays the same — `showTerrainTools` and `showCollisionTools` are already driven by `activeNode`, not by mode. No change needed here.

- [ ] **Step 4: Update right panel routing in App.tsx**

Replace the `rightContent` logic (around line 511-517):

```typescript
// OLD:
const rightContent = (() => {
  if (isWorldMode) return <WorldPropertiesPanel />;
  if (activeNode?.kind === 'settings_category' || mode === 'settings') return <SettingsRightPanel />;
  if (activeNode?.kind === 'scene_item' || activeNode?.kind === 'player' || (mode === 'scene')) return <ScenePropertiesPanel />;
  if (activeNode?.kind === 'collision') return <TerrainRightPanel />;
  return <TerrainRightPanel />;
})();

// NEW:
const rightContent = (() => {
  if (isWorldMode) return <WorldPropertiesPanel />;
  if (activeNode?.kind === 'settings_category') return <SettingsRightPanel />;
  if (activeNode?.kind === 'collision' || activeNode?.kind === 'terrain') return <TerrainRightPanel />;
  return <ScenePropertiesPanel />;
})();
```

- [ ] **Step 5: Update keyboard shortcut G-key handler**

In the keyboard handler (around line 387-421), change the G-key logic. Currently it checks `store.mode === 'scene'` for grab vs. `fill` for terrain. Update to check activeNode instead:

```typescript
// Around line 387, change:
if (e.key.toLowerCase() === 'g' && !meta) {
  if (store.mode === 'scene' && store.selectedEntity) {
// To:
if (e.key.toLowerCase() === 'g' && !meta) {
  const isTerrainActive = store.activeNode?.kind === 'terrain';
  if (!isTerrainActive && store.selectedEntity) {
```

And change the terrain fallback at line 419:

```typescript
// OLD:
    // Fall through to tool shortcut for terrain mode
    store.setTool('fill');
    return;

// NEW:
    if (isTerrainActive) {
      store.setTool('fill');
    }
    return;
```

- [ ] **Step 6: Update Shift orbit-lock shortcut**

Around line 467, change:

```typescript
// OLD:
if (e.key === 'Shift' && (store.mode === 'terrain' || store.activeNode?.kind === 'collision')) {
// NEW:
if (e.key === 'Shift' && (store.activeNode?.kind === 'terrain' || store.activeNode?.kind === 'collision')) {
```

- [ ] **Step 7: Fix any remaining `mode === 'terrain'` or `mode === 'settings'` references**

Search `App.tsx` for any remaining references to the old modes. The `showTerrainTools` variable (line 506) checks `mode === 'terrain'` — update it:

```typescript
// OLD:
const showTerrainTools = !isCollisionMode && (mode === 'terrain' || (activeNode?.kind === 'terrain'));

// NEW:
const showTerrainTools = !isCollisionMode && (activeNode?.kind === 'terrain');
```

- [ ] **Step 8: Update ProjectTree click handler**

In `ProjectTree.tsx`, the `click()` function auto-switches modes when clicking nodes. Remove mode switches to 'terrain' and 'settings' — everything now stays in 'scene' mode:

Find the click handler and remove any `setMode('terrain')` or `setMode('settings')` calls. Clicking a terrain node should just set `activeNode` without changing mode. Clicking a settings node should just set `activeNode` and `selectedSettingsCategory`.

- [ ] **Step 9: Update useSceneStore setMode default**

In `useSceneStore.ts`, find the initial state where `mode` is set. If it defaults to `'terrain'`, change it to `'scene'`.

- [ ] **Step 10: Commit**

```bash
git add tools/apps/bricklayer/src/store/types.ts \
       tools/apps/bricklayer/src/App.tsx \
       tools/apps/bricklayer/src/panels/ProjectTree.tsx \
       tools/apps/bricklayer/src/store/useSceneStore.ts
git commit -m "feat: reduce Bricklayer to 2-mode tab bar (WORLD/SCENE)"
```

---

### Task 2: Add Instances and Portals to WorldTree

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/WorldTree.tsx`

- [ ] **Step 1: Import new store actions**

Add `addInstance`, `removeInstance`, `addPortal`, `removePortal` to the store selectors:

```typescript
const addInstance = useWorldStore((s) => s.addInstance);
const removeInstance = useWorldStore((s) => s.removeInstance);
const addPortal = useWorldStore((s) => s.addPortal);
const removePortal = useWorldStore((s) => s.removePortal);
```

- [ ] **Step 2: Add Instances section**

After the Streaming Volumes section (before the closing `</div>`), add:

```tsx
{/* Instances */}
<div style={styles.section}>
  <div style={styles.sectionHeader}>
    <span style={styles.sectionTitle}>
      <span>⬚</span>
      <span>Instances</span>
    </span>
    <button
      style={styles.addBtn}
      onClick={() => addInstance('New Instance', '')}
      title="Add instance"
    >+</button>
  </div>
  {manifest.instances.map((inst) => {
    const isSelected = selectedEntity?.type === 'instance' && selectedEntity.id === inst.id;
    return (
      <div
        key={inst.id}
        style={{
          ...styles.item,
          ...(isSelected ? styles.itemSelected : styles.itemDefault),
        }}
        onClick={() => setSelectedEntity({ type: 'instance', id: inst.id })}
      >
        <span style={styles.itemLabel}>
          {inst.display_name || inst.id}
        </span>
        <button
          style={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); removeInstance(inst.id); }}
          title="Remove instance"
        >
          ×
        </button>
      </div>
    );
  })}
  {manifest.instances.length === 0 && (
    <div style={{ color: '#555', padding: '4px 8px', fontSize: 11 }}>No instances</div>
  )}
</div>
```

- [ ] **Step 3: Add Portals section**

After the Instances section, add:

```tsx
{/* Portals */}
<div style={styles.section}>
  <div style={styles.sectionHeader}>
    <span style={styles.sectionTitle}>
      <span>⟐</span>
      <span>Portals</span>
    </span>
    <button style={styles.addBtn} onClick={addPortal} title="Add portal">+</button>
  </div>
  {manifest.portals.map((portal) => {
    const isSelected = selectedEntity?.type === 'portal' && selectedEntity.id === portal.id;
    return (
      <div
        key={portal.id}
        style={{
          ...styles.item,
          ...(isSelected ? styles.itemSelected : styles.itemDefault),
        }}
        onClick={() => setSelectedEntity({ type: 'portal', id: portal.id })}
      >
        <span style={styles.itemLabel}>
          {portal.display_name || portal.id}
        </span>
        <button
          style={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); removePortal(portal.id); }}
          title="Remove portal"
        >
          ×
        </button>
      </div>
    );
  })}
  {manifest.portals.length === 0 && (
    <div style={{ color: '#555', padding: '4px 8px', fontSize: 11 }}>No portals</div>
  )}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add tools/apps/bricklayer/src/panels/WorldTree.tsx
git commit -m "feat(world-tree): add Instances and Portals sections"
```

---

### Task 3: Add Instance and Portal Editors to WorldPropertiesPanel

**Files:**
- Modify: `tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx`

- [ ] **Step 1: Import WorldInstance and WorldPortal types**

Add to imports:

```typescript
import type { WorldInstance, WorldPortal } from '@gseurat/project-root';
```

- [ ] **Step 2: Add InstanceEditor component**

Add after `StreamingVolumeEditor`:

```tsx
function InstanceEditor({ id }: { id: string }) {
  const inst = useWorldStore((s) => s.manifest.instances.find((i) => i.id === id));
  const updateInstance = useWorldStore((s) => s.updateInstance);

  if (!inst) return null;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Instance" />

      <label style={labelStyle}>ID</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>{inst.id}</div>

      <label style={labelStyle}>Display Name</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={inst.display_name}
          placeholder="Instance name"
          onChange={(e) => updateInstance(id, { display_name: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>Scene File</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={inst.scene_file}
          placeholder="assets/scenes/room.json"
          onChange={(e) => updateInstance(id, { scene_file: e.target.value })}
          style={fullInputStyle}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add PortalEditor component**

Add after `InstanceEditor`:

```tsx
function PortalEditor({ id }: { id: string }) {
  const portal = useWorldStore((s) => s.manifest.portals.find((p) => p.id === id));
  const updatePortal = useWorldStore((s) => s.updatePortal);
  const instances = useWorldStore((s) => s.manifest.instances);
  const chunks = useWorldStore((s) => s.manifest.chunks);

  if (!portal) return null;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Portal" />

      <label style={labelStyle}>ID</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>{portal.id}</div>

      <label style={labelStyle}>Display Name</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={portal.display_name}
          placeholder="Portal name"
          onChange={(e) => updatePortal(id, { display_name: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>Position</label>
      <Vec3Input
        value={portal.position}
        onChange={(v) => updatePortal(id, { position: v as [number, number, number] })}
        step={0.5}
      />

      <label style={labelStyle}>Half Extents</label>
      <Vec3Input
        value={portal.half_extents}
        onChange={(v) => updatePortal(id, { half_extents: v as [number, number, number] })}
        step={0.1}
        min={0.1}
      />

      <label style={labelStyle}>Source Chunk</label>
      <div style={rowStyle}>
        <select
          value={portal.source_chunk}
          onChange={(e) => updatePortal(id, { source_chunk: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        >
          {chunks.map((c) => {
            const key = chunkGridKey(c.grid);
            return <option key={key} value={key}>[{c.grid[0]}, {c.grid[1]}, {c.grid[2]}]</option>;
          })}
        </select>
      </div>

      <label style={labelStyle}>Target Instance</label>
      <div style={rowStyle}>
        <select
          value={portal.target_instance}
          onChange={(e) => updatePortal(id, { target_instance: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        >
          <option value="">-- Select instance --</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.display_name || inst.id}</option>
          ))}
        </select>
      </div>

      <label style={labelStyle}>Target Spawn Point</label>
      <Vec3Input
        value={portal.target_spawn}
        onChange={(v) => updatePortal(id, { target_spawn: v as [number, number, number] })}
        step={0.5}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire editors into WorldPropertiesPanel**

Update the `WorldPropertiesPanel` component to render the new editors:

```tsx
export function WorldPropertiesPanel() {
  useComponentRegistry('WorldPropertiesPanel');

  const selectedEntity = useWorldStore((s) => s.selectedEntity);

  return (
    <div style={{ color: '#ccc', fontSize: 12 }}>
      <WorldSettingsEditor />

      {selectedEntity?.type === 'chunk' && (
        <ChunkEditor gridKey={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'streaming_volume' && (
        <StreamingVolumeEditor id={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'instance' && (
        <InstanceEditor id={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'portal' && (
        <PortalEditor id={selectedEntity.id} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add tools/apps/bricklayer/src/panels/WorldPropertiesPanel.tsx
git commit -m "feat(world-properties): add Instance and Portal editors"
```

---

### Task 4: Build and Verify

**Files:**
- None (verification only)

- [ ] **Step 1: Verify project-root compiles**

Run: `cd tools/packages/project-root && pnpm exec tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Run schema tests**

Run: `cd tools && pnpm --filter @gseurat/tests run test:world-schema`
Expected: 7/7 passing

- [ ] **Step 3: Commit the plan and spec files**

```bash
git add docs/superpowers/plans/2026-04-18-bricklayer-unified-nav-tree.md \
       docs/superpowers/specs/2026-04-18-bricklayer-world-orchestrator-design.md
git commit -m "docs: add Phase 2 implementation plan"
```
