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
