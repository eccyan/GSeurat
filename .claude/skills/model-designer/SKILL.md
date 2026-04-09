---
name: model-designer
description: Use when creating or editing voxel characters in Echidna — automates the browser-based voxel editor via claude-in-chrome tools and Zustand store calls. Also use when the user asks to "build a character", "open echidna", "make a voxel model", or "design a model".
---

# Echidna Character Builder

Automated voxel character creation using the Echidna web editor (port 5179). Uses browser automation for navigation and visual verification, plus direct Zustand store calls for efficient voxel placement.

## When to Use

- User asks to "build a character" or "create a voxel character"
- User wants to edit an existing .echidna file
- User wants to export a character PLY for the GSeurat engine
- After designing a character that needs to be authored in Echidna

## Prerequisites

- Echidna must be running: `cd tools/apps/echidna && pnpm dev` (port 5179)
- Chrome browser open with Claude-in-Chrome extension active
- Character design decided (body parts, colors, approximate dimensions)

## Setup

**1. Start Echidna** (if not running):
```bash
cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter echidna dev &
```

**2. Open in browser:**
Use `mcp__claude-in-chrome__tabs_create_mcp` to open `http://localhost:5179`

**3. Verify loaded:**
Take a screenshot to confirm the 3-panel layout is visible (left toolbar, center viewport, right inspector).

## Core Strategy: Hybrid Automation

**Do NOT click individual voxels.** Instead:
1. Use `javascript_tool` to call Zustand store actions for data operations (place voxels, set colors, create parts, assign bones)
2. Use screenshots to visually verify results after each major step
3. Use browser clicks only for menu operations (File > Export) or UI that lacks store access

## Store Access

Access the Zustand store via Vite's ESM dynamic import (dev mode only):

```javascript
// PROVEN METHOD — works in Vite dev mode
const mod = await import('/src/store/useCharacterStore.ts');
window.__store = mod.useCharacterStore;
const state = window.__store.getState();
```

**If `window.__debugStore` is exposed** (after issue #119 is fixed):
```javascript
const state = window.__debugStore?.getState();
```

**IMPORTANT: placeVoxel() does NOT trigger viewport re-render** when called externally (issue #120).
Use the loadProject() workaround instead — see Phase 2 below.

### Proven Workflow: Build JSON + loadProject()

Since `placeVoxel()` doesn't trigger re-renders externally, the reliable approach is:
1. Build the full character as an `.echidna` JSON object in JavaScript
2. Call `store.getState().loadProject(json)` — this forces a complete state replacement and re-renders

```javascript
const character = {
  version: 1,
  characterName: "MyCharacter",
  gridWidth: 32,
  gridDepth: 32,
  voxels: [
    { x: 16, y: 0, z: 16, r: 212, g: 116, b: 44, a: 255 },
    // ... more voxels
  ],
  parts: [
    { id: "torso", parent: null, joint: [16, 0, 16], voxelKeys: ["16,0,16"] },
    // ... more parts
  ],
  poses: {},
  animations: {}
};
store.getState().loadProject(character);
```

### PLY Export: Use Python, Not Browser

The browser export triggers a download dialog that can't be automated. Instead, replicate the export in Python:
- Read the `.echidna` JSON from disk
- Apply surface culling (6-neighbor check)
- Write binary PLY with same format as `lib/plyExport.ts`
- See `assets/characters/warm_robot/` for a working example

## Workflow

### Phase 1: New Character

1. **Open Echidna** tab, verify UI loaded (screenshot)
2. **File > New** if needed (Cmd+N via keyboard shortcut)
3. **Set character name** via store or UI input

### Phase 2: Voxel Placement

For each body section, batch-place voxels via store:

```javascript
// Example: place a 3x3x3 cube of orange voxels for torso
const store = /* get store reference */;
for (let x = 14; x <= 16; x++)
  for (let y = 0; y <= 4; y++)
    for (let z = 15; z <= 16; z++)
      store.getState().placeVoxel(x, y, z);
```

**Color workflow:**
```javascript
// Set active color BEFORE placing voxels
store.getState().setActiveColor('#D4742C'); // orange
// Then place voxels — they inherit active color
```

**Verification:** Take screenshot after each body section to confirm shape.

### Phase 3: Body Parts & Bones

1. **Switch to Animate mode:**
   ```javascript
   store.getState().setMode('animate');
   ```

2. **Create parts:**
   ```javascript
   store.getState().addPart('torso');
   store.getState().addPart('head');
   store.getState().addPart('left_arm');
   // etc.
   ```

3. **Set hierarchy:**
   ```javascript
   store.getState().setPartParent('head', 'torso');
   store.getState().setPartParent('left_arm', 'torso');
   // etc.
   ```

4. **Set joint positions:**
   ```javascript
   store.getState().updatePartJoint('torso', [16, 0, 16]);
   store.getState().updatePartJoint('head', [16, 5, 16]);
   // etc.
   ```

5. **Assign voxels to parts:**
   ```javascript
   // Assign voxel keys (format: "x,y,z") to part
   store.getState().assignVoxelsToPart(['16,3,16', '16,4,16', ...], 'head');
   ```

6. **Screenshot** to verify — enable "Color by Part" to see assignments.

### Phase 4: Poses (Optional)

```javascript
store.getState().addPose('rest');
store.getState().updatePoseRotation('rest', 'left_arm', [0, 0, -80]); // degrees
```

### Phase 5: Export

1. **Save .echidna** (Cmd+S via shortcuts or store):
   ```javascript
   store.getState().saveProject(); // triggers download
   ```

2. **Export PLY** via File > Export PLY menu click:
   - Click File menu
   - Click "Export PLY..."
   - Downloads `{characterName}.ply`

3. **Copy PLY to assets:**
   ```bash
   cp ~/Downloads/{name}.ply /Users/eccyan/dev/GSeurat/assets/props/
   ```

## Keyboard Shortcuts Reference

| Key | Action | Mode |
|-----|--------|------|
| V | Place tool | Build |
| B | Paint tool | Build |
| E | Erase tool | Build |
| I | Eyedropper | Build |
| [ / ] | Brush size ±1 | Build |
| S | Box select | Animate |
| Space | Play/pause | Animate |
| Cmd+Z | Undo | Any |
| Cmd+S | Save | Any |
| Cmd+N | New | Any |

## Color Reference (Common Palettes)

| Style | Body | Accent | Eyes | Joints |
|-------|------|--------|------|--------|
| Classic Robot | #A0A0A0 | #4488CC | #44AAFF | #666666 |
| Warm Robot | #D4742C | #F2C744 | #F2C744 | #3A3A3A |
| Wooden | #8B6914 | #A0522D | #2E1A00 | #5C3A1E |
| Crystal | #6ECFCF | #FFFFFF | #FF6EC7 | #4A8A8A |

## Troubleshooting

This skill owns debugging for Echidna-related issues. When something doesn't work, investigate and fix it here rather than escalating to the user.

| Issue | Fix |
|-------|-----|
| Store not accessible | Use `import('/src/store/useCharacterStore.ts')` (Vite dev mode) or `window.__debugStore` (after #119) |
| Voxels not visible | Use `loadProject()` instead of individual `placeVoxel` calls — see re-render workaround above |
| Export fails | Ensure character has at least 1 voxel. Check browser console via `read_console_messages`. |
| Colors wrong | `setActiveColor` must be called BEFORE `placeVoxel` — voxels get color at creation time |
| Parts not showing | Switch to Animate mode and enable "Color by Part" in right panel |
| PLY export to disk | Use bridge REST: `POST /api/characters/:name/export-ply` with `outputPath`, or Python export script |

## Improvement Feedback

When using this skill, note any Echidna issues in a markdown file for the user's improvement cycle:
- Missing automation APIs (no socket server, no REST endpoints)
- Store actions that don't work as expected
- UI workflows that require too many clicks
- Missing features that would help character authoring

Save findings to a temporary file and present to the user at the end of the session.

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

## .echidna File Format

```json
{
  "version": 1,
  "characterName": "string",
  "gridWidth": 32,
  "gridDepth": 32,
  "voxels": [{ "x": 0, "y": 0, "z": 0, "r": 255, "g": 0, "b": 0, "a": 255 }],
  "parts": [{ "id": "string", "parent": "string|null", "joint": [0,0,0], "voxelKeys": ["x,y,z"] }],
  "poses": { "pose_name": { "rotations": { "part_id": [rx, ry, rz] } } },
  "animations": { "anim_name": { "name": "string", "keyframes": [{ "time": 0, "poseName": "string" }], "duration": 1.0 } }
}
```
