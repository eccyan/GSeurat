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
JSON.stringify(store.getState().mode)
store.getState().setMode('scene')
store.getState().addCameraVolume()
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
2. Add volumes/rails/triggers via store
3. Configure params in the inspector panel
4. Verify camera editors mounted in registry

### Send to Staging
1. Click File menu → "Open in Staging"
2. Wait 2 seconds for socket transfer
3. Verify with Game Director: `python3 scripts/game_director.py visual_state`
4. Check counts match Bricklayer

### Staging Camera Review
1. Activate: `python3 scripts/game_director.py camera_review on`
2. Walk: `python3 scripts/game_director.py camera_review_walk forward 2`
3. Check status: `python3 scripts/game_director.py camera_review status`

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
