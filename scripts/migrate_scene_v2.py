#!/usr/bin/env python3
"""
Migrate scene.json files from v1 to v2 format.

Changes:
- Adds "version": 2
- Renames: static_lights -> lights, placed_objects -> objects,
  gs_particle_emitters -> particle_emitters, gs_animations -> animations,
  nav_zone_names -> nav_zones
- Lights: position [x, z] + height -> position [x, height, z]
- Portals: position [x, z] -> position [x, 0, z]
- Torch positions: [x, z] -> [x, 0, z]
- NPC waypoints: [x, y] -> [x, 0, y]
- Player: flat fields -> nested player object
- gs_animation params: top-level params moved into nested "params" block

Usage: python3 scripts/migrate_scene_v2.py assets/scenes/*.json
       python3 scripts/migrate_scene_v2.py scene.json --dry-run
"""

import json
import sys
import copy
from pathlib import Path

ANIM_PARAM_KEYS = {
    "speed", "gravity", "velocity_scale", "noise_amplitude",
    "orbit_speed", "orbit_acceleration", "expansion", "height_rise",
    "opacity_fade", "scale_shrink",
}


def migrate_light(light: dict) -> dict:
    """Convert light position [x, z] + height -> [x, height, z]."""
    out = copy.deepcopy(light)
    pos = out.pop("position", [0, 0])
    height = out.pop("height", 0)
    # v1: position = [x, z], height = y
    # v2: position = [x, y, z]
    if len(pos) == 2:
        out["position"] = [pos[0], height, pos[1]]
    elif len(pos) == 3:
        # Already v2 format
        out["position"] = pos
    else:
        out["position"] = [0, height, 0]
    return out


def migrate_portal(portal: dict) -> dict:
    """Convert portal position [x, z] -> [x, 0, z]."""
    out = copy.deepcopy(portal)
    pos = out.get("position", [0, 0])
    if len(pos) == 2:
        out["position"] = [pos[0], 0, pos[1]]
    return out


def migrate_torch_pos(pos: list) -> list:
    """Convert torch position [x, z] -> [x, 0, z]."""
    if len(pos) == 2:
        return [pos[0], 0, pos[1]]
    return pos


def migrate_waypoint(wp: list) -> list:
    """Convert NPC waypoint [x, y] -> [x, 0, y]."""
    if len(wp) == 2:
        return [wp[0], 0, wp[1]]
    return wp


def migrate_npc(npc: dict) -> dict:
    """Migrate NPC waypoints to 3D."""
    out = copy.deepcopy(npc)
    if "waypoints" in out:
        out["waypoints"] = [migrate_waypoint(wp) for wp in out["waypoints"]]
    return out


def migrate_animation(anim: dict) -> dict:
    """Move top-level param fields into nested params block and convert to lifetime-centric."""
    out = copy.deepcopy(anim)
    old_params = out.pop("params", {})

    # Move top-level param keys into params block
    for key in list(out.keys()):
        if key in ANIM_PARAM_KEYS:
            old_params[key] = out.pop(key)

    # Convert old params to new lifetime-centric format
    new_params = {}
    lifetime = out.get("lifetime", 3.0)

    # orbit_speed -> rotations (approximate: rotations ~ orbit_speed * lifetime / (2*pi))
    if "orbit_speed" in old_params:
        os = old_params["orbit_speed"]
        new_params["rotations"] = round(os * lifetime * 2.0 / 6.2832, 2)

    # orbit_acceleration -> rotations_easing
    if "orbit_acceleration" in old_params:
        oa = old_params["orbit_acceleration"]
        if oa > 0:
            new_params["rotations_easing"] = "ease_in"
        elif oa < 0:
            new_params["rotations_easing"] = "ease_out"

    # expansion (keep as-is, already a multiplier)
    if "expansion" in old_params:
        new_params["expansion"] = old_params["expansion"]

    # height_rise (keep as-is)
    if "height_rise" in old_params:
        new_params["height_rise"] = old_params["height_rise"]

    # opacity_fade -> opacity_end (inverted: fade=1 means end=0)
    if "opacity_fade" in old_params:
        new_params["opacity_end"] = round(max(0, 1.0 - old_params["opacity_fade"]), 2)

    # scale_shrink -> scale_end (inverted: shrink=1 means end=0)
    if "scale_shrink" in old_params:
        new_params["scale_end"] = round(max(0, 1.0 - old_params["scale_shrink"]), 2)

    # velocity_scale -> velocity
    if "velocity_scale" in old_params:
        new_params["velocity"] = old_params["velocity_scale"]

    # noise_amplitude -> noise
    if "noise_amplitude" in old_params:
        new_params["noise"] = old_params["noise_amplitude"]

    # gravity (keep as-is)
    if "gravity" in old_params:
        new_params["gravity"] = old_params["gravity"]

    # speed -> drop (absorbed into lifetime-centric model)

    if new_params:
        out["params"] = new_params
    return out


def migrate_scene(data: dict) -> dict:
    """Convert a v1 scene dict to v2 format."""
    if data.get("version", 1) >= 2:
        print("  Already v2, skipping")
        return data

    out = {"version": 2}

    # Ambient color
    if "ambient_color" in data:
        out["ambient_color"] = data["ambient_color"]

    # God rays
    if "god_rays_intensity" in data:
        out["god_rays_intensity"] = data["god_rays_intensity"]

    # Lights (renamed from static_lights)
    lights = data.get("static_lights", [])
    if lights:
        out["lights"] = [migrate_light(l) for l in lights]

    # Player (grouped from flat fields)
    player = {}
    if "player_position" in data:
        player["position"] = data["player_position"]
    if "player_tint" in data:
        player["tint"] = data["player_tint"]
    if "player_facing" in data:
        player["facing"] = data["player_facing"]
    if "player_character_id" in data:
        player["character_id"] = data["player_character_id"]
    # Also accept already-grouped player
    if "player" in data:
        player = data["player"]
    if player:
        out["player"] = player

    # NPCs (with waypoint migration)
    npcs = data.get("npcs", [])
    if npcs:
        out["npcs"] = [migrate_npc(n) for n in npcs]

    # Portals (position migration)
    portals = data.get("portals", [])
    if portals:
        out["portals"] = [migrate_portal(p) for p in portals]

    # Objects (renamed from placed_objects)
    objects = data.get("placed_objects", data.get("objects", []))
    if objects:
        out["objects"] = objects

    # Particle emitters (renamed from gs_particle_emitters)
    emitters = data.get("gs_particle_emitters", data.get("particle_emitters", []))
    if emitters:
        out["particle_emitters"] = emitters

    # Animations (renamed from gs_animations, params consolidated)
    animations = data.get("gs_animations", data.get("animations", []))
    if animations:
        out["animations"] = [migrate_animation(a) for a in animations]

    # Gaussian splat (pass through)
    if "gaussian_splat" in data:
        out["gaussian_splat"] = data["gaussian_splat"]

    # Collision (pass through)
    if "collision" in data:
        out["collision"] = data["collision"]

    # Background layers (pass through)
    bg = data.get("background_layers", [])
    if bg:
        out["background_layers"] = bg

    # Weather (pass through)
    if "weather" in data:
        out["weather"] = data["weather"]

    # Day/night (pass through)
    if "day_night" in data:
        out["day_night"] = data["day_night"]

    # VFX emitters (pass through)
    for key in ["torch_emitter", "footstep_emitter", "npc_aura_emitter"]:
        if key in data:
            out[key] = data[key]

    # Torch positions (migrate to 3D)
    torch_pos = data.get("torch_positions", [])
    if torch_pos:
        out["torch_positions"] = [migrate_torch_pos(p) for p in torch_pos]

    # Torch audio positions (already 3D, pass through)
    if "torch_audio_positions" in data:
        out["torch_audio_positions"] = data["torch_audio_positions"]

    # Nav zones (renamed from nav_zone_names)
    nav = data.get("nav_zone_names", data.get("nav_zones", []))
    if nav:
        out["nav_zones"] = nav

    # Tilemap (pass through)
    if "tilemap" in data:
        out["tilemap"] = data["tilemap"]
    if "tile_animations" in data:
        out["tile_animations"] = data["tile_animations"]

    return out


def main():
    dry_run = "--dry-run" in sys.argv
    files = [f for f in sys.argv[1:] if not f.startswith("--")]

    if not files:
        print(f"Usage: {sys.argv[0]} [--dry-run] <scene.json> ...")
        sys.exit(1)

    for filepath in files:
        path = Path(filepath)
        if not path.exists():
            print(f"SKIP: {filepath} (not found)")
            continue

        print(f"Migrating: {filepath}")
        with open(path, "r") as f:
            data = json.load(f)

        migrated = migrate_scene(data)

        if dry_run:
            print(json.dumps(migrated, indent=2)[:500] + "\n...")
        else:
            with open(path, "w") as f:
                json.dump(migrated, f, indent=2)
                f.write("\n")
            print(f"  Written: {filepath}")

    print(f"\nDone. Migrated {len(files)} file(s).")


if __name__ == "__main__":
    main()
