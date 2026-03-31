#!/usr/bin/env python3
"""Game Director — automated playtesting via the GSeurat control server.

Uses a persistent connection (the control server only allows one client).

Usage:
  python scripts/game_director.py screenshot [path]
  python scripts/game_director.py player
  python scripts/game_director.py perf
  python scripts/game_director.py walk <direction> <seconds>
  python scripts/game_director.py playtest [output_dir]
"""

import json
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
GLFW_KEY_TAB = 258
GLFW_KEY_ESCAPE = 256
GLFW_KEY_SPACE = 32

DIRECTION_KEYS = {
    "forward": GLFW_KEY_W, "back": GLFW_KEY_S,
    "left": GLFW_KEY_A, "right": GLFW_KEY_D,
    "w": GLFW_KEY_W, "s": GLFW_KEY_S, "a": GLFW_KEY_A, "d": GLFW_KEY_D,
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
        # Give server a moment to register the connection
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
    time.sleep(0.3)  # Wait for frame render + write
    return result


def get_player_state() -> dict:
    return send_command({"cmd": "get_player_state"})


def get_perf() -> dict:
    return send_command({"cmd": "get_perf"})


def get_features() -> dict:
    return send_command({"cmd": "get_features"})


def inject_key(key: int, down: bool = True) -> dict:
    return send_command({"cmd": "inject_key", "key": key, "down": down})


def inject_key_once(key: int) -> dict:
    return send_command({"cmd": "inject_key_once", "key": key})


def clear_keys() -> dict:
    return send_command({"cmd": "clear_keys"})


def walk(direction: str, seconds: float = 1.0):
    key = DIRECTION_KEYS.get(direction.lower())
    if key is None:
        print(f"Unknown direction: {direction}")
        return

    print(f"Walking {direction} for {seconds}s...")
    inject_key(key, True)
    time.sleep(seconds)
    inject_key(key, False)
    clear_keys()

    state = get_player_state()
    pos = state.get("position")
    if pos:
        print(f"Player position: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")


def playtest(output_dir: str = "playtest_output"):
    """Automated playtest: walk all directions, take screenshots, generate report."""
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

        state = get_player_state()
        pos = state.get("position")
        perf = get_perf()

        ss_path = os.path.join(output_dir, f"{len(report['steps']):02d}_{name.replace(' ', '_')}.png")
        screenshot(ss_path)

        entry = {
            "name": name,
            "position": pos,
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

    # 3. Walk in each direction
    start_state = get_player_state()
    start_pos = start_state.get("position", [0, 0, 0])

    for d in ["forward", "right", "back", "left"]:
        before = get_player_state().get("position", [0, 0, 0])
        walk(d, 1.5)
        after = get_player_state().get("position", [0, 0, 0])

        moved = any(abs(a - b) > 0.1 for a, b in zip(before, after))
        entry = step(f"after_walk_{d}")
        entry["moved"] = moved
        if not moved:
            report["issues"].append(f"Player did not move when walking {d}")
            print(f"  *** ISSUE: Player stuck walking {d}!")

    # 4. Final state
    clear_keys()
    step("final_state")

    # 5. Movement check
    final_pos = get_player_state().get("position", [0, 0, 0])
    total_distance = sum((a - b) ** 2 for a, b in zip(start_pos, final_pos)) ** 0.5
    report["total_movement"] = total_distance
    print(f"\nTotal displacement from start: {total_distance:.1f} units")

    if total_distance < 1.0:
        report["issues"].append("Player barely moved — likely stuck")

    # 6. Performance check
    perf = get_perf()
    gc = perf.get("gaussian_count", 0)
    vc = perf.get("visible_count", 0)
    if gc > 0 and vc / gc < 0.1:
        report["issues"].append(f"Very low visible ratio: {vc}/{gc}")

    # Write report
    report_path = os.path.join(output_dir, "report.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n{'='*50}")
    print(f"Playtest complete: {len(report['steps'])} steps, {len(report['issues'])} issues")
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
            state = get_player_state()
            pos = state.get("position")
            if pos:
                print(f"Player position: ({pos[0]:.1f}, {pos[1]:.1f}, {pos[2]:.1f})")
            else:
                print("No player entity found")

        elif cmd == "perf":
            perf = get_perf()
            print(f"Gaussians: {perf.get('visible_count')}/{perf.get('gaussian_count')} "
                  f"(max: {perf.get('max_capacity')})")

        elif cmd == "walk":
            if len(sys.argv) < 3:
                print("Usage: game_director.py walk <direction> [seconds]")
                return
            direction = sys.argv[2]
            seconds = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
            walk(direction, seconds)

        elif cmd == "playtest":
            output_dir = sys.argv[2] if len(sys.argv) > 2 else "playtest_output"
            playtest(output_dir)

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

        else:
            print(f"Unknown command: {cmd}")
            print(__doc__)


if __name__ == "__main__":
    main()
