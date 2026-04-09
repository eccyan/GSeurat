#!/usr/bin/env python3
"""Scenario Runner — end-to-end user workflow tests for GSeurat tools.

Chains browser automation (Chrome MCP) and Game Director socket commands
into role-specific test scenarios.

Usage:
  python scripts/scenario_runner.py --list
  python scripts/scenario_runner.py --role level-designer
  python scripts/scenario_runner.py --scenario staging_panels
  python scripts/scenario_runner.py --all
"""

import argparse
import json
import os
import sys
import time
import traceback

# Import Game Director for socket communication
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game_director as gd


class ScenarioResult:
    def __init__(self, name: str):
        self.name = name
        self.steps: list[tuple[str, bool, str, float]] = []

    def step(self, description: str, passed: bool, detail: str = "", elapsed: float = 0.0):
        self.steps.append((description, passed, detail, elapsed))
        status = "PASS" if passed else "FAIL"
        msg = f"  {status}  {description}"
        if detail:
            msg += f" -- {detail}"
        if elapsed > 0:
            msg += f" ({elapsed:.1f}s)"
        print(msg)

    @property
    def passed(self) -> bool:
        return all(s[1] for s in self.steps)

    def summary(self) -> str:
        p = sum(1 for s in self.steps if s[1])
        return f"{'PASS' if self.passed else 'FAIL'} ({p}/{len(self.steps)} steps)"


SCENARIOS: dict[str, dict] = {}


def scenario(name: str, role: str, description: str):
    def decorator(fn):
        SCENARIOS[name] = {"role": role, "fn": fn, "description": description}
        return fn
    return decorator


@scenario("staging_panels", "level-designer",
          "Launch Staging, verify all panels are on-screen via visual_state")
def scenario_staging_panels() -> ScenarioResult:
    result = ScenarioResult("staging_panels")

    t0 = time.time()
    try:
        gd._conn = gd.GameConnection()
        gd._conn.connect()
        result.step("Connected to Staging", True, elapsed=time.time() - t0)
    except Exception as e:
        result.step("Connected to Staging", False, str(e))
        return result

    t0 = time.time()
    try:
        vs = gd.get_visual_state()
        result.step("Got visual_state", vs.get("type") == "ok",
                     detail=f"{len(vs.get('panels', []))} panels",
                     elapsed=time.time() - t0)
    except Exception as e:
        result.step("Got visual_state", False, str(e))
        return result

    panels = vs.get("panels", [])
    off_screen = [p for p in panels if p.get("visible") and not p.get("on_screen")]
    if off_screen:
        names = ", ".join(p["name"] for p in off_screen)
        result.step("All visible panels on-screen", False, f"Off-screen: {names}")
    else:
        visible_count = sum(1 for p in panels if p.get("visible"))
        result.step("All visible panels on-screen", True, f"{visible_count} visible")

    gizmos = vs.get("gizmos", {})
    result.step("Gizmo state reported", len(gizmos) > 0, f"{len(gizmos)} gizmo types")

    scene = vs.get("scene", {})
    result.step("Scene state reported", True,
                f"terrain={'yes' if scene.get('terrain_loaded') else 'no'}, "
                f"gaussians={scene.get('gaussians_total', 0)}")

    gd._conn.close()
    return result


@scenario("staging_snapshot", "level-designer",
          "Take snapshot, verify diff reports no changes when nothing changes")
def scenario_staging_snapshot() -> ScenarioResult:
    result = ScenarioResult("staging_snapshot")

    try:
        gd._conn = gd.GameConnection()
        gd._conn.connect()
        result.step("Connected to Staging", True)
    except Exception as e:
        result.step("Connected to Staging", False, str(e))
        return result

    path = gd.snapshot_save("_scenario_test")
    result.step("Snapshot saved", os.path.exists(path), path)

    time.sleep(0.1)
    diff = gd.snapshot_diff("_scenario_test")
    changed = diff.get("changed", {})
    stable_changes = {k: v for k, v in changed.items()
                      if "fps" not in k and "frame_time" not in k and "anim_time" not in k}
    result.step("No unexpected changes in snapshot diff",
                len(stable_changes) == 0,
                f"{len(stable_changes)} changed" if stable_changes else "clean")

    try:
        os.remove(path)
    except OSError:
        pass

    gd._conn.close()
    return result


def run_scenarios(names: list[str]) -> bool:
    print()
    all_passed = True
    for name in names:
        entry = SCENARIOS.get(name)
        if not entry:
            print(f"Unknown scenario: {name}")
            all_passed = False
            continue
        print(f"--- Scenario: {name} ---")
        print(f"    {entry['description']}")
        try:
            result = entry["fn"]()
        except Exception as e:
            print(f"  FAIL  Scenario crashed: {e}")
            traceback.print_exc()
            result = ScenarioResult(name)
            result.step("Scenario execution", False, str(e))
        print(f"RESULT: {result.summary()}")
        print()
        if not result.passed:
            all_passed = False
    return all_passed


def main():
    parser = argparse.ArgumentParser(description="GSeurat Scenario Runner")
    parser.add_argument("--list", action="store_true", help="List available scenarios")
    parser.add_argument("--role", type=str, help="Run all scenarios for a role")
    parser.add_argument("--scenario", type=str, help="Run a specific scenario")
    parser.add_argument("--all", action="store_true", help="Run all scenarios")
    args = parser.parse_args()

    if args.list:
        roles = {}
        for name, entry in sorted(SCENARIOS.items()):
            roles.setdefault(entry["role"], []).append((name, entry["description"]))
        for role, scenarios in sorted(roles.items()):
            print(f"\n=== {role} ===")
            for name, desc in scenarios:
                print(f"  {name:30s}  {desc}")
        return

    if args.scenario:
        success = run_scenarios([args.scenario])
    elif args.role:
        names = [n for n, e in SCENARIOS.items() if e["role"] == args.role]
        if not names:
            print(f"No scenarios for role: {args.role}")
            return
        print(f"=== Role: {args.role} ({len(names)} scenarios) ===")
        success = run_scenarios(names)
    elif args.all:
        print(f"=== All scenarios ({len(SCENARIOS)} total) ===")
        success = run_scenarios(list(SCENARIOS.keys()))
    else:
        parser.print_help()
        return

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
