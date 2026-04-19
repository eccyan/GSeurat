---
name: game-director
description: Use when playtesting or polishing the GSeurat island demo — automates walking, screenshots, and visual evaluation via the Unix socket control server. Also use when the user asks to "run the game director" or "keep polishing the demo". Can also test Staging app and Bricklayer integration via socket commands and Chrome browser automation.
---

# Game Director

## Scope

Game Director is for **demo app playtesting only**. For creative tool workflows, use the role-specific skills:
- **Level Designer** — Bricklayer + Staging scene authoring
- **Model Designer** — Echidna character creation and animation
- **VFX Designer** — Melies VFX editing
- **Sound Designer** — Audio Composer

Game Director commands (walk, screenshot, perf, triggers, tour, playtest) work with the demo app. The `visual_state` and `snapshot` commands work with Staging.

Automated playtesting for the GSeurat demo and Staging app via Unix socket control server. Walk the player, take screenshots, analyze visuals, fix issues, rebuild, and repeat. Can also drive Bricklayer UI via Chrome browser automation for end-to-end integration testing.

## When to Use

- User asks to "polish the demo" or "run the game director"
- After making visual changes (lighting, particles, camera, props) that need verification
- To evaluate the island demo from multiple viewpoints
- To test Game Object triggers (proximity, animation, emissive)
- To test Bricklayer → Staging integration (PBD, game objects, VFX)
- To verify PBD physics (tree sway, chain demo) works after shader/renderer changes

## Setup

**1. Build the demo:**
```bash
cmake --build --preset macos-release --target gseurat_demo
# or macos-debug for validation logs
```

**2. Launch from build directory** (shaders load relative to CWD):
```bash
cd build/macos-release && ./gseurat_demo &
# or have user launch manually if background fails
```

**3. Wait for socket** then verify connection:
```bash
sleep 6 && python3 scripts/game_director.py player
```

### Staging Setup

For testing Staging (receives scenes from Bricklayer):
```bash
cmake --build --preset macos-debug
cd build/macos-debug && ./gseurat_staging &
sleep 5
# Staging uses the same /tmp/gseurat.sock — Game Director commands work
```

## Commands

| Command | Usage | Notes |
|---------|-------|-------|
| `player` | Get player position | `(x, y, z)` world coords |
| `perf` | Get Gaussian counts | `visible/total (max)` |
| `triggers` | Get trigger states | Active/idle triggers + emitter count |
| `game_objects` | List game objects + NPCs | Scene objects, live NPC positions, patrol state |
| `screenshot <path>` | Capture frame to PNG | Read with `Read` tool to analyze |
| `walk <dir> <secs>` | Move player | `forward`, `back`, `left`, `right` |
| `goto <x> <z>` | Navigate to position | Also accepts POI names: `goto torch_1` |
| `pois` | List all named POIs | Points of interest with coordinates |
| `tour [dir]` | Full guided tour | Visits ALL interactive objects, verifies triggers |
| `playtest [dir]` | Quick playtest | Walks key locations, takes screenshots |
| `features` | List feature flags | ON/OFF status |
| `quit` | Shutdown demo | Sends quit command via socket |

## Direct Socket Commands

For Staging or custom testing, send JSON commands directly via Python:
```python
import socket, json
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect('/tmp/gseurat.sock')
# Send scene with PBD config to Staging
scene = {
    'game_objects': [{
        'id': 'obj_1', 'name': 'Tree', 'position': [64, 0, 48],
        'ply_file': 'assets/props/tree.ply',
        'pbd': {'mode': 'wind_sway', 'wind_strength': 0.06, 'wind_frequency': 0.8}
    }]
}
cmd = {'cmd': 'load_scene_json', 'json': json.dumps(scene)}
s.sendall(json.dumps(cmd).encode() + b'\n')
print(json.loads(s.recv(4096)))
s.close()
```

## Bricklayer Browser Automation

For end-to-end Bricklayer → Staging testing, use Chrome MCP tools:

**1. Get browser context:**
```
mcp__claude-in-chrome__tabs_context_mcp (createIfEmpty: true)
```

**2. Navigate to Bricklayer (create new tab if needed):**
```
mcp__claude-in-chrome__tabs_create_mcp
mcp__claude-in-chrome__navigate (url: "http://localhost:5180/", tabId: ...)
```

**3. Interact with UI:**
```
mcp__claude-in-chrome__read_page (filter: "interactive")  → get element refs
mcp__claude-in-chrome__form_input (ref: "ref_N", value: "...")  → set form values
mcp__claude-in-chrome__computer (action: "left_click", coordinate: [...])  → click buttons
mcp__claude-in-chrome__computer (action: "screenshot")  → capture viewport
```

**4. Example: Add game object with PBD Wind Sway:**
- Click "+" next to Game Objects
- Click the new object to select it
- Use `form_input` on PLY File field: `assets/test_models/blub.ply`
- Use `form_input` on PBD Physics dropdown: `wind_sway`
- Click File → "Open in Staging"

**5. Verify in Staging logs:**
Look for `[GS] PBD: N objects configured` and `[GS] Loaded N Gaussians`

**Important:** The Chrome extension tab group may need to be visible (not collapsed). If screenshots fail with "0 width", create a new tab via `tabs_create_mcp` and navigate to the URL.

## Named Points of Interest

| POI | Position (x, z) | Description |
|-----|------------------|-------------|
| spawn | (187, 197) | Player spawn point |
| house | (192, 175) | Central house |
| torch_1-4 | (195,181) (185,173) (201,191) (211,185) | Torches near house |
| crystal_1 | (155, 145) | Crystal (northwest) |
| crystal_2 | (225, 195) | Crystal (east) |
| crystal_3 | (175, 235) | Crystal (south) |
| crystal_4 | (195, 120) | Crystal (north, cyan) |
| anim_pulse | (151, 111) | Pulse animation trigger |
| anim_wave | (231, 171) | Wave animation trigger |
| anim_vortex | (131, 211) | Vortex animation trigger |
| anim_float | (171, 261) | Float animation trigger |
| shore_n | (180, 100) | Northern shore |
| shore_s | (180, 280) | Southern shore |

## Position-Based Navigation

`walk_to(x, z)` navigates using short burst walks with course correction:
- Camera faces -Z by default (azimuth=0)
- Forward = -Z, Back = +Z, Left = -X, Right = +X
- Walks in 0.15s bursts, rechecks position, adjusts heading
- Default tolerance: 3 units, max time: 20s

## Feedback Loop Pattern

```
screenshot → Read (analyze) → identify issue → edit code/assets →
rebuild → quit demo → relaunch → screenshot → verify fix → repeat
```

**Quit and relaunch cycle:**
```bash
python3 scripts/game_director.py quit
sleep 2 && cmake --build --preset macos-release --target gseurat_demo 2>&1 | tail -3
cd /path/to/build/macos-release && ./gseurat_demo &
sleep 6 && python3 scripts/game_director.py player
```

**Bricklayer integration cycle:**
```
Edit code → rebuild debug → restart Staging →
Chrome: navigate Bricklayer → set PBD config → "Open in Staging" →
Check Staging logs for [GS] PBD → screenshot via socket → verify
```

## Tour vs Playtest

**`tour`** — Comprehensive: visits every interactive object (torches, crystals, animation triggers, shores), verifies triggers fire on proximity, takes screenshots at each stop, generates detailed report.

**`playtest`** — Quick: walks to 4 key locations, validates movement, captures screenshots, checks basic perf. Use for rapid iteration.

## What to Look For

**Good signs:** Character visible and solid, props at correct elevation, particles as small dots, terrain with directional shadow bands, crystal glow on proximity, trees swaying gently

**Bad signs:** Bright foreground blobs (particle scale too large or bloom threshold too low), character transparent/washed out (exposure too high), empty screen (near-plane cull too aggressive), flickering (sort or barrier issue), black screen (NaN in sort keys from PBD quaternion bug)

## Common Fixes

| Issue | Fix |
|-------|-----|
| Bright blobs | Reduce particle `scale_min`/`scale_max` in gs_particle.cpp |
| Character washed out | Lower `pp.exposure` or `light_intensity` |
| No crystal glow | Check `EmissiveToggle` fires in logs, verify `add_gs_particle_emitter` called |
| Animation not firing | Check player distance to trigger, increase `ProximityTrigger.radius` |
| Terrain blur | Increase camera `elevation_` or `distance_` |
| House speckly | Regenerate PLY: `mesh_to_ply.py --density 200 --gs-scale 0.1` |
| Release-only artifacts | Stage mapped memory writes via local buffer + memcpy (see feedback_mapped_memory_staging.md) |
| Black screen | Check PBD prev_position initialized to identity quat (0,0,0,1), check PbdState stride matches PbdPhysicsState (64 bytes) |
| Trees not swaying | Verify `set_effect_time()` called, check `inv_mass > 0` for wind mode, check `constraint_count == 0` |
| PBD not working in Staging | PBD upload must be in `app_base::load_gs_scene`, not demo state |
| Game object PLY not loading | Ensure `load_gs_scene` handles objects without `gaussian_splat` terrain |
| Gizmo position wrong | Game object gizmos should NOT apply AABB offset (raw world coords) |
