# Keyframe Animator

Animation clip editor and state machine graph editor for the vulkan-game engine. Manages the clip definitions consumed by `AnimationController` and the state transitions enforced by `AnimationStateMachine`.

## Panels

The interface is split into three resizable panels:

- **Clip List** (left) — all defined clips with CRUD operations
- **Timeline** (center) — frame strip for the selected clip with per-frame duration editing
- **State Machine** (right) — draggable node graph of states and transitions

## Features

### Clip Editor

Each `AnimationClip` has:

- **Name** — must match the pattern `{state}_{direction}` expected by the state machine (e.g. `walk_left`, `idle_down`)
- **Row** — zero-based row index in the sprite sheet (0-11 for the 12-row player sheet)
- **Frame count** — number of columns (1-4)
- **Frame duration** — seconds per frame, draggable directly on the timeline strip
- **Loop** — whether the clip loops or holds the last frame

Drag the right edge of any frame cell in the timeline to adjust its duration. The total clip duration is shown in the toolbar.

### Sprite Sheet Preview

A read-only canvas next to the timeline shows the sprite sheet rows. The selected row is highlighted and the current playback frame is outlined. Playback controls:

| Button | Action |
|---|---|
| Play / Pause | Toggle looping playback at real-time speed |
| Step | Advance one frame |
| Speed | 0.25x / 0.5x / 1x / 2x multiplier |

### State Machine Graph

Each node represents an animation state (e.g. `idle`, `walk`, `run`). Edges are directed transitions with an optional condition label. Nodes are freely draggable.

Operations:

- **Add state** — double-click empty canvas area
- **Add transition** — drag from a node's output port to another node
- **Delete** — select node or edge and press Delete
- **Rename** — double-click a node label

The state machine editor does not enforce transition logic; conditions are labels only and the actual guard code lives in `AnimationStateMachine` (C++). The graph is exported as metadata alongside the clip list.

### Clip CRUD

| Action | How |
|---|---|
| New clip | Click "+ Clip" in the clip list header |
| Duplicate | Right-click clip, choose Duplicate |
| Delete | Select clip, press Delete or use context menu |
| Reorder | Drag rows in the clip list |

## Engine Integration

Clips are exported as a JSON array matching the `AnimationClip` struct used by the engine:

```json
[
  { "name": "idle_down", "row": 0, "frame_count": 4, "frame_duration": 0.30, "loop": true },
  { "name": "walk_down", "row": 3, "frame_count": 4, "frame_duration": 0.12, "loop": true },
  { "name": "run_down",  "row": 6, "frame_count": 4, "frame_duration": 0.07, "loop": true }
]
```

Click "Sync to Engine" to POST the JSON to the bridge. The engine hot-reloads the clip definitions without restarting the scene.

## AI Generation

When Ollama is available, the "AI Generate" panel accepts a plain-language description:

> "A fast three-frame dash animation with a slight anticipation pose"

Ollama returns a suggested clip definition (name, row, frame_count, frame_duration) which is inserted as a new clip. The suggestion can be edited before accepting.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause preview |
| `Ctrl+S` | Save and export JSON |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Delete` | Delete selected clip or transition |
