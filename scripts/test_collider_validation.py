#!/usr/bin/env python3
"""Integration test: verify Staging engine handles degenerate collider values.

Connects to the running Staging engine via Unix socket and sends
update_scene_data commands with game objects containing degenerate collider
values (zero, negative, extreme). Asserts that the engine does not crash
and continues responding after each payload.

Prerequisites:
  - Staging engine running (gseurat_staging / island_demo)
  - Any scene loaded

Usage:
  python scripts/test_collider_validation.py
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_director as gd


class TestResult:
    def __init__(self):
        self.steps: list[tuple[str, bool, str]] = []

    def step(self, description: str, passed: bool, detail: str = ""):
        self.steps.append((description, passed, detail))
        status = "\033[32mPASS\033[0m" if passed else "\033[31mFAIL\033[0m"
        msg = f"  {status}  {description}"
        if detail:
            msg += f" -- {detail}"
        print(msg)

    @property
    def passed(self) -> bool:
        return all(s[1] for s in self.steps)

    def summary(self) -> str:
        p = sum(1 for s in self.steps if s[1])
        total = len(self.steps)
        color = "\033[32m" if self.passed else "\033[31m"
        return f"{color}{'PASS' if self.passed else 'FAIL'}\033[0m ({p}/{total} steps)"


def send_cmd(cmd: dict) -> dict:
    return gd._conn.send(cmd)


def make_scene(game_objects: list[dict]) -> dict:
    """Build a minimal scene JSON with the given game objects."""
    return {
        "ambient_color": [0.3, 0.3, 0.4],
        "static_lights": [],
        "game_objects": game_objects,
        "gs_particle_emitters": [],
        "gs_animations": [],
        "vfx_instances": [],
        "camera_zones": {"volumes": [], "triggers": []},
    }


def make_game_object(obj_id: str, shape: dict) -> dict:
    """Build a game object with a ColliderComponent."""
    return {
        "id": obj_id,
        "name": f"Test {obj_id}",
        "position": [10, 0, 10],
        "rotation": [0, 0, 0],
        "scale": 1,
        "components": {
            "ColliderComponent": {
                "shape": shape,
                "offset": [0, 0, 0],
                "is_trigger": False,
                "is_dynamic": False,
            }
        },
    }


def send_scene_with_collider(obj_id: str, shape: dict) -> dict:
    """Send update_scene_data with a single game object containing the shape."""
    scene = make_scene([make_game_object(obj_id, shape)])
    return send_cmd({"cmd": "update_scene_data", "json": json.dumps(scene)})


def verify_engine_alive() -> bool:
    """Verify the engine responds to a harmless command."""
    try:
        resp = send_cmd({"cmd": "list_colliders"})
        return resp.get("type") == "ok"
    except Exception:
        return False


def run_tests() -> TestResult:
    result = TestResult()

    # ── Connect ──
    try:
        gd._conn = gd.GameConnection()
        gd._conn.connect()
        result.step("Connected to Staging engine", True)
    except Exception as e:
        result.step("Connected to Staging engine", False, str(e))
        return result

    # ── Baseline: valid sphere ──
    resp = send_scene_with_collider("valid_sphere", {"type": "sphere", "radius": 1.0})
    result.step("Baseline: valid sphere (radius=1.0)", resp.get("type") == "ok")

    # ── Test 1: Sphere with radius=0 ──
    resp = send_scene_with_collider("sphere_r0", {"type": "sphere", "radius": 0})
    result.step("Sphere radius=0 accepted", resp.get("type") == "ok")
    result.step("Engine alive after radius=0", verify_engine_alive())

    # ── Test 2: Sphere with negative radius ──
    resp = send_scene_with_collider("sphere_neg", {"type": "sphere", "radius": -5.0})
    result.step("Sphere radius=-5 accepted", resp.get("type") == "ok")
    result.step("Engine alive after radius=-5", verify_engine_alive())

    # ── Test 3: Box with zero half_extents ──
    resp = send_scene_with_collider("box_zero", {"type": "box", "half_extents": [0, 0, 0]})
    result.step("Box half_extents=[0,0,0] accepted", resp.get("type") == "ok")
    result.step("Engine alive after zero extents", verify_engine_alive())

    # ── Test 4: Box with negative half_extents ──
    resp = send_scene_with_collider("box_neg", {"type": "box", "half_extents": [-5, -5, -5]})
    result.step("Box half_extents=[-5,-5,-5] accepted", resp.get("type") == "ok")
    result.step("Engine alive after negative extents", verify_engine_alive())

    # ── Test 5: Capsule with zero dimensions ──
    resp = send_scene_with_collider("capsule_zero", {"type": "capsule", "radius": 0, "half_height": 0})
    result.step("Capsule radius=0 half_height=0 accepted", resp.get("type") == "ok")
    result.step("Engine alive after zero capsule", verify_engine_alive())

    # ── Test 6: Capsule with negative values ──
    resp = send_scene_with_collider("capsule_neg", {"type": "capsule", "radius": -2.0, "half_height": -3.0})
    result.step("Capsule radius=-2 half_height=-3 accepted", resp.get("type") == "ok")
    result.step("Engine alive after negative capsule", verify_engine_alive())

    # ── Test 7: Extremely large radius ──
    resp = send_scene_with_collider("sphere_huge", {"type": "sphere", "radius": 1e6})
    result.step("Sphere radius=1e6 accepted", resp.get("type") == "ok")
    result.step("Engine alive after huge radius", verify_engine_alive())

    # ── Test 8: Missing shape fields (default fallback) ──
    resp = send_scene_with_collider("sphere_default", {"type": "sphere"})
    result.step("Sphere with no radius (uses default 0.5)", resp.get("type") == "ok")
    result.step("Engine alive after missing radius", verify_engine_alive())

    # ── Test 9: Unknown shape type (falls back to sphere) ──
    resp = send_scene_with_collider("unknown", {"type": "cylinder", "radius": 1.0})
    result.step("Unknown shape 'cylinder' accepted (fallback to sphere)", resp.get("type") == "ok")
    result.step("Engine alive after unknown type", verify_engine_alive())

    # ── Test 10: Empty shape object ──
    resp = send_scene_with_collider("empty_shape", {})
    result.step("Empty shape object accepted", resp.get("type") == "ok")
    result.step("Engine alive after empty shape", verify_engine_alive())

    # ── Test 11: Multiple degenerate colliders in one scene ──
    scene = make_scene([
        make_game_object("multi_1", {"type": "sphere", "radius": 0}),
        make_game_object("multi_2", {"type": "box", "half_extents": [-1, -1, -1]}),
        make_game_object("multi_3", {"type": "capsule", "radius": 0, "half_height": 0}),
        make_game_object("multi_4", {"type": "sphere", "radius": 1e6}),
        make_game_object("multi_5", {"type": "box", "half_extents": [0, 0, 0]}),
    ])
    resp = send_cmd({"cmd": "update_scene_data", "json": json.dumps(scene)})
    result.step("5 degenerate colliders in one scene accepted", resp.get("type") == "ok")
    result.step("Engine alive after multi-degenerate scene", verify_engine_alive())

    # ── Restore: send empty scene to clean up ──
    resp = send_cmd({"cmd": "update_scene_data", "json": json.dumps(make_scene([]))})
    result.step("Cleanup: empty scene accepted", resp.get("type") == "ok")
    result.step("Engine alive after cleanup", verify_engine_alive())

    gd._conn.close()
    return result


if __name__ == "__main__":
    print("=" * 60)
    print("Collider Validation Integration Test")
    print("=" * 60)
    print()

    result = run_tests()

    print()
    print("-" * 60)
    print(f"Result: {result.summary()}")
    print("-" * 60)

    sys.exit(0 if result.passed else 1)
