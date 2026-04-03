#!/usr/bin/env python3
"""Game Director — automated playtesting via the GSeurat control server.

Uses a persistent connection to the Unix socket control server.

Usage:
  python scripts/game_director.py screenshot [path]
  python scripts/game_director.py player
  python scripts/game_director.py perf
  python scripts/game_director.py triggers
  python scripts/game_director.py walk <direction> <seconds>
  python scripts/game_director.py goto <x> <z>
  python scripts/game_director.py tour [output_dir]
  python scripts/game_director.py playtest [output_dir]
"""

import json
import math
import os
import socket
import sys
import time

SOCKET_PATH = "/tmp/gseurat.sock"

# GLFW key codes
GLFW_KEY_W = 87
GLFW_KEY_A = 65
GLFW_KEY_S = 83
GLFW_KEY_D = 68
GLFW_KEY_E = 69
GLFW_KEY_P = 80
GLFW_KEY_N = 78
GLFW_KEY_TAB = 258
GLFW_KEY_ESCAPE = 256
GLFW_KEY_SPACE = 32

DIRECTION_KEYS = {
    "forward": GLFW_KEY_W, "back": GLFW_KEY_S,
    "left": GLFW_KEY_A, "right": GLFW_KEY_D,
    "w": GLFW_KEY_W, "s": GLFW_KEY_S, "a": GLFW_KEY_A, "d": GLFW_KEY_D,
}

# Player walk speed in the demo (units/sec)
PLAYER_SPEED = 20.0

# ── Points of Interest on the island ──
# Map is 384×384, player spawns near (187, ~2, 197)
POIS = {
    "spawn":     (187, 197, "Player spawn point"),
    "house":     (192, 175, "Central house"),
    "fountain":  (178, 185, "Stone fountain (water sparkle)"),
    "torch_1":   (195, 181, "Torch near house (east)"),
    "torch_2":   (185, 173, "Torch near house (south)"),
    "torch_3":   (201, 191, "Torch (northeast)"),
    "torch_4":   (211, 185, "Torch (far east)"),
    "crystal_1": (155, 145, "Crystal (northwest)"),
    "crystal_2": (225, 195, "Crystal (east)"),
    "crystal_3": (175, 235, "Crystal (south)"),
    "crystal_4": (195, 120, "Crystal (north, cyan)"),
    "anim_pulse": (151, 111, "Pulse animation trigger"),
    "anim_wave":  (231, 171, "Wave animation trigger"),
    "anim_vortex":(131, 211, "Vortex animation trigger"),
    "anim_float": (171, 261, "Float animation trigger"),
    "treasure":  (235, 145, "Hidden treasure chest (gold burst)"),
    "mushrooms": (135, 215, "Glowing mushroom grove"),
    "slime":     (183, 190, "Friendly slime NPC"),
    "secret_summit": (160, 110, "Secret: Summit (fireworks!)"),
    "secret_cove":   (250, 230, "Secret: Hidden Cove"),
    "secret_grove":  (120, 160, "Secret: Ancient Grove"),
    "shore_n":   (180, 100, "Northern shore"),
    "shore_s":   (180, 280, "Southern shore"),
}


class GameConnection:
    """Persistent connection to the GSeurat control server."""

    def __init__(self, socket_path: str = SOCKET_PATH):
        self.socket_path = socket_path
        self.sock = None

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(10)
        self.sock.connect(self.socket_path)
        time.sleep(0.1)

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None

    def send(self, cmd: dict) -> dict:
        """Send a command and wait for response (JSON line)."""
        if not self.sock:
            self.connect()
        payload = json.dumps(cmd) + "\n"
        self.sock.sendall(payload.encode("utf-8"))
        data = b""
        while b"\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("Server closed connection")
            data += chunk
        return json.loads(data.decode("utf-8").strip())

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.close()


# Global connection (set in main)
_conn: GameConnection = None


def send_command(cmd: dict) -> dict:
    return _conn.send(cmd)


def screenshot(path: str = "game_director_screenshot.png") -> dict:
    result = send_command({"cmd": "screenshot", "path": path})
    time.sleep(0.3)
    return result


def get_player_pos():
    """Return (x, y, z) tuple or None."""
    state = send_command({"cmd": "get_player_state"})
    pos = state.get("position")
    if pos and len(pos) >= 3:
        return (pos[0], pos[1], pos[2])
    return None


def get_player_state() -> dict:
    return send_command({"cmd": "get_player_state"})


def get_perf() -> dict:
    return send_command({"cmd": "get_perf"})


def get_features() -> dict:
    return send_command({"cmd": "get_features"})


def get_triggers() -> dict:
    return send_command({"cmd": "get_triggers"})


def inject_key(key: int, down: bool = True) -> dict:
    return send_command({"cmd": "inject_key", "key": key, "down": down})


def inject_key_once(key: int) -> dict:
    return send_command({"cmd": "inject_key_once", "key": key})


def clear_keys() -> dict:
    return send_command({"cmd": "clear_keys"})


def walk(direction: str, seconds: float = 1.0):
    """Walk in a cardinal direction for a given duration."""
    key = DIRECTION_KEYS.get(direction.lower())
    if key is None:
        print(f"Unknown direction: {direction}")
        return

    print(f"Walking {direction} for {seconds:.1f}s...")
    inject_key(key, True)
    time.sleep(seconds)
    inject_key(key, False)
    clear_keys()

    pos = get_player_pos()
    if pos:
        print(f"  Position: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")


def walk_to(target_x: float, target_z: float, tolerance: float = 3.0,
            max_time: float = 20.0) -> bool:
    """Navigate to a world position using cardinal keys. Returns True if reached."""
    print(f"Navigating to ({target_x:.0f}, {target_z:.0f})...")
    start = time.time()
    step_dur = 0.15  # walk in short bursts for course correction

    while time.time() - start < max_time:
        pos = get_player_pos()
        if not pos:
            print("  ERROR: No player position")
            return False

        dx = target_x - pos[0]  # positive = need to go +X
        dz = target_z - pos[2]  # positive = need to go +Z

        dist = math.sqrt(dx * dx + dz * dz)
        if dist < tolerance:
            print(f"  Arrived at ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f}) "
                  f"(dist={dist:.1f})")
            return True

        # Camera faces -Z by default (azimuth=0).
        # Forward = -Z, Back = +Z, Left = -X, Right = +X
        # Walk the axis with the larger delta first
        keys_down = []
        if abs(dz) > tolerance:
            keys_down.append(GLFW_KEY_W if dz < 0 else GLFW_KEY_S)
        if abs(dx) > tolerance:
            keys_down.append(GLFW_KEY_D if dx > 0 else GLFW_KEY_A)

        if not keys_down:
            break

        for k in keys_down:
            inject_key(k, True)
        time.sleep(step_dur)
        for k in keys_down:
            inject_key(k, False)
        clear_keys()

    pos = get_player_pos()
    if pos:
        remaining = math.sqrt((target_x - pos[0])**2 + (target_z - pos[2])**2)
        print(f"  Stopped at ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f}) "
              f"(remaining={remaining:.1f})")
    return False


def count_triggered() -> int:
    """Return number of currently triggered proximity triggers."""
    data = get_triggers()
    triggers = data.get("triggers", [])
    return sum(1 for t in triggers if t.get("triggered"))


def tour(output_dir: str = "tour_output"):
    """Guided tour visiting all interactive objects with effect verification."""
    os.makedirs(output_dir, exist_ok=True)
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "stops": [],
        "issues": [],
    }
    step_num = [0]

    def snap(name: str, check_triggers: bool = False):
        """Take screenshot and record state at current position."""
        pos = get_player_pos()
        perf = get_perf()
        trig = get_triggers() if check_triggers else {}

        ss_path = os.path.join(output_dir,
                               f"{step_num[0]:02d}_{name.replace(' ', '_')}.png")
        screenshot(ss_path)

        triggered_count = sum(1 for t in trig.get("triggers", [])
                              if t.get("triggered"))
        emitter_count = trig.get("emitter_count", 0)

        entry = {
            "name": name,
            "position": list(pos) if pos else None,
            "gaussian_count": perf.get("gaussian_count"),
            "visible_count": perf.get("visible_count"),
            "triggered": triggered_count,
            "emitters": emitter_count,
            "screenshot": ss_path,
        }
        report["stops"].append(entry)
        step_num[0] += 1

        if pos:
            print(f"  [{name}] pos=({pos[0]:.1f},{pos[1]:.1f},{pos[2]:.1f}) "
                  f"GS={perf.get('visible_count')}/{perf.get('gaussian_count')} "
                  f"trig={triggered_count} emit={emitter_count}")
        return entry

    def visit(poi_name: str, wait: float = 1.0, check_triggers: bool = True):
        """Navigate to a POI, wait for effects, and take a screenshot."""
        if poi_name not in POIS:
            print(f"  Unknown POI: {poi_name}")
            return None
        x, z, desc = POIS[poi_name]
        print(f"\n=== {poi_name}: {desc} ===")
        reached = walk_to(x, z)
        if not reached:
            report["issues"].append(f"Could not reach {poi_name} ({desc})")
        time.sleep(wait)  # let effects trigger
        return snap(poi_name, check_triggers=check_triggers)

    # ── Tour sequence ──
    print("=" * 60)
    print("ISLAND TOUR — visiting all interactive objects")
    print("=" * 60)

    # 0. Initial state at spawn
    snap("spawn_initial")

    # 1. Enable compact HUD
    inject_key_once(GLFW_KEY_TAB)
    time.sleep(0.2)
    snap("hud_on")

    # 2. Visit house and fountain
    visit("house", wait=0.5, check_triggers=False)
    entry = visit("fountain", wait=2.0)
    if entry and entry.get("triggered", 0) == 0:
        report["issues"].append("fountain: no triggers fired on approach")

    # 3. Visit torches (should trigger EmitterToggle + LightToggle)
    for i in range(1, 5):
        name = f"torch_{i}"
        entry = visit(name, wait=1.5)
        if entry and entry.get("triggered", 0) == 0:
            report["issues"].append(f"{name}: no triggers fired on approach")

    # 4. Return near spawn, then visit crystals (EmissiveToggle)
    visit("spawn", wait=0.3, check_triggers=False)

    for i in range(1, 5):
        name = f"crystal_{i}"
        entry = visit(name, wait=2.0)
        if entry and entry.get("triggered", 0) == 0:
            report["issues"].append(f"{name}: no triggers fired on approach")

    # 5. Discover fun objects
    entry = visit("slime", wait=2.0)
    if entry and entry.get("triggered", 0) == 0:
        report["issues"].append("slime: no pulse trigger on approach")

    entry = visit("treasure", wait=2.5)
    if entry and entry.get("triggered", 0) == 0:
        report["issues"].append("treasure: no gold burst on approach")

    entry = visit("mushrooms", wait=2.0)
    if entry and entry.get("triggered", 0) == 0:
        report["issues"].append("mushrooms: no glow trigger on approach")

    # 6. Visit animation triggers
    for effect in ["pulse", "wave", "vortex", "float"]:
        name = f"anim_{effect}"
        visit(name, wait=2.5)

    # 7. Discover secrets!
    for secret in ["secret_summit", "secret_cove", "secret_grove"]:
        entry = visit(secret, wait=3.0)
        if entry and entry.get("triggered", 0) == 0:
            report["issues"].append(f"{secret}: discovery zone did not trigger")

    # 8. Visit shores for boundary check
    visit("shore_n", wait=0.5, check_triggers=False)
    visit("shore_s", wait=0.5, check_triggers=False)

    # 8. Return to spawn
    visit("spawn", wait=0.5, check_triggers=False)

    # 9. Final state
    snap("final_state", check_triggers=True)

    # ── Performance summary ──
    perf = get_perf()
    gc = perf.get("gaussian_count", 0)
    vc = perf.get("visible_count", 0)
    if gc > 0 and vc / gc < 0.1:
        report["issues"].append(f"Very low visible ratio: {vc}/{gc}")

    # ── Write report ──
    report_path = os.path.join(output_dir, "tour_report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"Tour complete: {len(report['stops'])} stops, "
          f"{len(report['issues'])} issues")
    if report["issues"]:
        print("Issues found:")
        for issue in report["issues"]:
            print(f"  - {issue}")
    else:
        print("No issues found!")
    print(f"Report: {report_path}")
    print(f"Screenshots: {output_dir}/")
    return report


def playtest(output_dir: str = "playtest_output"):
    """Quick playtest: walk a route, take screenshots, check basics."""
    os.makedirs(output_dir, exist_ok=True)
    report = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "steps": [],
        "issues": [],
    }

    def step(name: str, action=None):
        print(f"\n--- {name} ---")
        if action:
            action()
            time.sleep(0.3)

        pos = get_player_pos()
        perf = get_perf()

        ss_path = os.path.join(output_dir,
                               f"{len(report['steps']):02d}_{name.replace(' ', '_')}.png")
        screenshot(ss_path)

        entry = {
            "name": name,
            "position": list(pos) if pos else None,
            "gaussian_count": perf.get("gaussian_count"),
            "visible_count": perf.get("visible_count"),
            "screenshot": ss_path,
        }
        report["steps"].append(entry)
        if pos:
            print(f"  Position: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")
        print(f"  Gaussians: {perf.get('visible_count')}/{perf.get('gaussian_count')}")
        return entry

    # 1. Initial state
    step("initial_state")

    # 2. Toggle debug HUD
    step("toggle_hud", lambda: inject_key_once(GLFW_KEY_TAB))

    # 3. Walk to key locations
    start_pos = get_player_pos() or (0, 0, 0)

    walk_targets = [
        ("house", 192, 175),
        ("torch_area", 195, 181),
        ("crystal_1", 155, 145),
        ("spawn", 187, 197),
    ]

    for label, tx, tz in walk_targets:
        before = get_player_pos() or (0, 0, 0)
        walk_to(tx, tz, tolerance=5.0, max_time=15.0)
        after = get_player_pos() or (0, 0, 0)
        moved = math.sqrt(sum((a - b)**2 for a, b in zip(before, after))) > 1.0
        entry = step(f"at_{label}")
        entry["moved"] = moved
        if not moved:
            report["issues"].append(f"Player did not move toward {label}")

    # 4. Final
    clear_keys()
    step("final_state")

    # 5. Check perf
    perf = get_perf()
    gc = perf.get("gaussian_count", 0)
    vc = perf.get("visible_count", 0)
    if gc > 0 and vc / gc < 0.1:
        report["issues"].append(f"Very low visible ratio: {vc}/{gc}")

    report_path = os.path.join(output_dir, "report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n{'=' * 50}")
    print(f"Playtest complete: {len(report['steps'])} steps, "
          f"{len(report['issues'])} issues")
    if report["issues"]:
        print("Issues found:")
        for issue in report["issues"]:
            print(f"  - {issue}")
    print(f"Report: {report_path}")
    print(f"Screenshots: {output_dir}/")
    return report


def main():
    global _conn

    if len(sys.argv) < 2:
        print(__doc__)
        return

    cmd = sys.argv[1]

    with GameConnection() as conn:
        _conn = conn

        if cmd == "screenshot":
            path = sys.argv[2] if len(sys.argv) > 2 else "game_director_screenshot.png"
            result = screenshot(path)
            print(f"Screenshot: {result}")

        elif cmd == "player":
            pos = get_player_pos()
            if pos:
                print(f"Player position: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")
            else:
                print("No player entity found")

        elif cmd == "perf":
            perf = get_perf()
            print(f"Gaussians: {perf.get('visible_count')}/{perf.get('gaussian_count')} "
                  f"(max: {perf.get('max_capacity')})")

        elif cmd == "triggers":
            data = get_triggers()
            triggers = data.get("triggers", [])
            emitters = data.get("emitter_count", 0)
            triggered = sum(1 for t in triggers if t.get("triggered"))
            print(f"Triggers: {triggered}/{len(triggers)} active, "
                  f"{emitters} emitters")
            for t in triggers:
                state = "ACTIVE" if t["triggered"] else "idle"
                print(f"  [{state:>6}] ({t['x']:.0f}, {t['y']:.1f}, {t['z']:.0f}) "
                      f"r={t['radius']:.0f}")

        elif cmd == "walk":
            if len(sys.argv) < 3:
                print("Usage: game_director.py walk <direction> [seconds]")
                return
            direction = sys.argv[2]
            seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
            walk(direction, seconds)

        elif cmd == "goto":
            if len(sys.argv) < 4:
                print("Usage: game_director.py goto <x> <z>")
                print("Named POIs:")
                for name, (x, z, desc) in sorted(POIS.items()):
                    print(f"  {name:15s}  ({x:3d}, {z:3d})  {desc}")
                return
            # Accept named POI or numeric coordinates
            if sys.argv[2] in POIS:
                x, z, desc = POIS[sys.argv[2]]
                print(f"Going to {sys.argv[2]}: {desc}")
            else:
                x = float(sys.argv[2])
                z = float(sys.argv[3])
            walk_to(x, z)

        elif cmd == "tour":
            output_dir = sys.argv[2] if len(sys.argv) > 2 else "tour_output"
            tour(output_dir)

        elif cmd == "playtest":
            output_dir = sys.argv[2] if len(sys.argv) > 2 else "playtest_output"
            playtest(output_dir)

        elif cmd == "pois":
            print("Points of Interest:")
            for name, (x, z, desc) in sorted(POIS.items()):
                print(f"  {name:15s}  ({x:3d}, {z:3d})  {desc}")

        elif cmd == "features":
            features = get_features()
            for f in features.get("features", []):
                status = "ON" if f["enabled"] else "off"
                print(f"  [{status:>3}] {f['label']}")

        elif cmd == "interact":
            print("Pressing E key...")
            inject_key_once(GLFW_KEY_E)
            time.sleep(0.1)
            state = get_player_state()
            print(f"Player: {state}")

        elif cmd == "quit":
            result = send_command({"cmd": "quit"})
            print(f"Quit: {result.get('message', 'sent')}")

        else:
            print(f"Unknown command: {cmd}")
            print(__doc__)


if __name__ == "__main__":
    main()
