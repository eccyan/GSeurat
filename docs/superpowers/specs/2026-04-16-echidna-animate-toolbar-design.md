# Echidna Animate ToolBar

## Goal

Add a dedicated toolbar for Animate mode so users can switch between Assign Part, Box Select, and Lasso Select without relying on keyboard shortcuts. Introduce a neutral Orbit tool that becomes the default when switching modes, preventing accidental edits from tools carried over from the other mode.

This is sub-project 1 of a broader Animate panel improvement initiative. Future sub-projects (per-bone tracks, keyframe editing UX, pose management, playback controls, preview) will build on this foundation.

## Architecture

### Mode-specific toolbars

Build mode keeps its existing `ToolBar`. Animate mode gets a new `AnimateToolBar` mounted above the existing `AnimateLeftPanel` in the left column:

```
Build mode                Animate mode
┌──────────────┐          ┌──────────────────┐
│  ToolBar     │          │ AnimateToolBar   │  <- NEW
│  (existing)  │          ├──────────────────┤
└──────────────┘          │ AnimateLeftPanel │
                          │ (existing)       │
                          └──────────────────┘
```

The two toolbars share no state beyond `activeTool` and `selectedPart`. Build tools and Animate tools are isolated — Build mode cannot activate Animate tools and vice versa.

### Orbit tool

Add a new neutral tool `'orbit'` to `ToolType`. In orbit mode, pointer interactions in the viewport only move the camera (using existing orbit controls) — no placement, painting, selection, or assignment.

Orbit appears as the first tool button in both `ToolBar` and `AnimateToolBar`. Keyboard shortcut: **Q** (valid in both modes).

### Mode switch behavior

When `setMode()` is called, `activeTool` is always reset to `'orbit'`. This guarantees that switching from Build to Animate (or vice versa) never leaves the user with a tool that would modify the wrong thing on their next click. The user must explicitly pick the next tool.

### AnimateToolBar contents

1. **Tools section**
   - Orbit (Q)
   - Assign Part (A)
   - Box Select (S)
   - Lasso Select (L)

2. **Target Bone dropdown**
   - Lists all bones in `asset.characterParts`
   - Bound to `selectedPart` — selecting a bone here updates the store, and the BoneTree below reflects the change (and vice versa)
   - Shows "No bones" and is disabled when the asset has no parts

## Data flow

```
User presses Q (or clicks Orbit button)
  -> setTool('orbit')
  -> activeTool = 'orbit'
  -> viewport pointer events only drive camera

User switches mode (Build <-> Animate)
  -> setMode(newMode)
  -> activeTool = 'orbit'  (always reset)
  -> user picks next tool explicitly

User selects bone in dropdown
  -> setSelectedPart(boneId)
  -> selectedPart updates
  -> BoneTree highlights the same bone
```

## Files changed

| File | Change |
|------|--------|
| `tools/apps/echidna/src/store/types.ts` | Add `'orbit'` to `ToolType` union |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | `setMode()` resets `activeTool` to `'orbit'` |
| `tools/apps/echidna/src/App.tsx` | Add `q` key binding to `'orbit'` in both tool key maps; render `AnimateToolBar` above `AnimateLeftPanel` in animate mode |
| `tools/apps/echidna/src/panels/ToolBar.tsx` | Add Orbit (Q) as first tool button |
| `tools/apps/echidna/src/panels/AnimateToolBar.tsx` | New — Orbit + Assign Part + Box Select + Lasso + Target Bone dropdown |
| `tools/apps/echidna/src/viewport/*` | Skip voxel/selection interactions when `activeTool === 'orbit'` |
| `tools/apps/echidna/src/__tests__/animateToolBar.test.ts` | Mode switch → orbit; orbit tool available in both modes |

## Testing

- **Unit test:** `setMode('animate')` with `activeTool = 'place'` → `activeTool === 'orbit'`
- **Unit test:** `setMode('build')` with `activeTool = 'assign_part'` → `activeTool === 'orbit'`
- **Unit test:** `setTool('orbit')` works in both Build and Animate modes
- **Manual test:** Open Echidna, switch Build → Animate, verify toolbar shows Orbit selected, verify clicking viewport moves camera only (no edits)
