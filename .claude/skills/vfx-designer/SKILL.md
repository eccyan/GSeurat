---
name: vfx-designer
description: Use when creating or editing VFX in Melies (particle effects, emitter regions, animation regions). Also use when the user asks to "create VFX", "edit particles", "design effects", or "open melies".
---

# VFX Designer

Automates the Melies VFX editor (port 5181) workflow. Uses browser automation for UI, Game Director for Staging verification.

## When to Use

- User asks to create or edit VFX/particle effects
- User wants to configure emitter or animation regions
- User wants to preview VFX in Staging
- After implementing any Melies UI feature

## Prerequisites

- Melies running: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies dev` (port 5181)
- Chrome browser with Claude-in-Chrome extension active

## Setup

**1. Start Melies:**
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
2. Configure spawn shape, rate, lifetime
3. Set particle colors, size, velocity
4. Verify Component Registry — emitter editor mounted

### VFX to Staging
1. Export VFX scene
2. Open in Staging
3. Verify via `python3 scripts/game_director.py visual_state` that vfx_instances count matches

## Verification Checklist

After any Melies UI change:
1. Component Registry health check — no missing, no errors
2. Read browser console — no React errors
3. Run `python3 scripts/scenario_runner.py --role vfx-designer`

## Handoff

- **To Level Designer**: VFX scenes placed in Bricklayer scene composition
