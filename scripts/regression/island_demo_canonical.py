"""Canonical 60-second island_demo walkthrough for regression diffing.

Run via: python3 scripts/regression/run_harness.py
Standalone: python3 scripts/regression/island_demo_canonical.py --output-dir <dir>

The engine MUST be running with --deterministic.  Frame-aligned input dispatch
ensures the same scenario produces bit-identical pixels across runs.

POI names intentionally omitted from the input timeline: there is no "goto"
command in the engine's command dispatcher (goto is a high-level Game Director
concept, not a raw engine command).  Instead, player position is set via
inject_key sequences or teleport via set_player_pos if available.  The timeline
below uses only inject_key commands, which are always available.

# TODO: if the engine gains a teleport command in the future, replace the long
# walk sequences with precise teleports keyed to POI coords from
# scripts/game_director.py POIS dict.
"""
import argparse
import json
import os
import socket
import sys

SOCKET_PATH = "/tmp/gseurat.sock"

# GLFW key codes (must match GLFW_KEY_* constants used by the engine)
GLFW_KEY_W = 87
GLFW_KEY_A = 65
GLFW_KEY_S = 83
GLFW_KEY_D = 68

# Frames at which to capture screenshots (60 Hz simulation, 60 s total = 3300 f + frame 0).
CAPTURE_FRAMES = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300]

# Frame-aligned input timeline: (frame_number, JSON command dict).
# All inputs use inject_key/clear_keys which are registered engine commands.
INPUT_TIMELINE = [
    (1,    {"cmd": "inject_key", "key": GLFW_KEY_W, "down": True}),   # start walking forward
    (300,  {"cmd": "clear_keys"}),                                      # stop at 5 s
    (301,  {"cmd": "inject_key", "key": GLFW_KEY_W, "down": True}),   # resume walk
    (360,  {"cmd": "clear_keys"}),                                      # stop before portal area
    (361,  {"cmd": "inject_key", "key": GLFW_KEY_W, "down": True}),   # walk through portal
    (420,  {"cmd": "clear_keys"}),                                      # stop
    (1200, {"cmd": "inject_key", "key": GLFW_KEY_W, "down": True}),   # 20 s: walk toward forest
    (1800, {"cmd": "clear_keys"}),                                      # 30 s: stop in forest
    (1801, {"cmd": "inject_key", "key": GLFW_KEY_S, "down": True}),   # 30 s + 1f: walk back
    (2400, {"cmd": "clear_keys"}),                                      # 40 s: stop
    (2401, {"cmd": "inject_key", "key": GLFW_KEY_S, "down": True}),   # 40 s: continue back
    (2700, {"cmd": "clear_keys"}),                                      # 45 s: stop
    # 3300 = end (linger 5 s for any post-portal effect detection window)
]


def send_cmd(sock, cmd_dict):
    """Send a JSON command and return the parsed JSON response."""
    payload = json.dumps(cmd_dict) + "\n"
    sock.sendall(payload.encode("utf-8"))
    data = b""
    while not data.endswith(b"\n"):
        chunk = sock.recv(65536)
        if not chunk:
            break
        data += chunk
    return json.loads(data.decode("utf-8").strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--socket", default=SOCKET_PATH)
    args = parser.parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        sock.connect(args.socket)
    except (FileNotFoundError, ConnectionRefusedError) as e:
        sys.stderr.write(
            f"failed to connect to {args.socket}: {e}\n"
            "Is the engine running with --deterministic? "
            "(harness orchestrator should have spawned it)\n")
        sys.exit(1)

    # Step engine in deterministic mode using BATCHED step calls.
    # Per-frame round-trips are paced at ~2 Hz on macOS due to GLFW runloop
    # integration (~480 ms each), making `step 1` × 3300 take ~50 minutes.
    # Instead, we step in chunks bounded by event/capture frames, reducing
    # round-trips from 3300 to ~24. Sync `step` semantics (response after
    # frames complete) ensure screenshot ordering is correct.
    capture_set = set(CAPTURE_FRAMES)

    # Build a sorted timeline of (frame, action_callable). Each action is
    # either an inject_key/clear_keys send, or a screenshot send.
    events = []
    for f, cmd in INPUT_TIMELINE:
        events.append((f, "input", cmd))
    for f in CAPTURE_FRAMES:
        events.append((f, "capture", None))
    events.sort(key=lambda e: (e[0], 0 if e[1] == "input" else 1))

    current_frame = 0
    for frame_no, kind, cmd in events:
        if frame_no > current_frame:
            send_cmd(sock, {"cmd": "step", "n": frame_no - current_frame})
            current_frame = frame_no
        if kind == "input":
            send_cmd(sock, cmd)
        else:
            out_path = os.path.join(args.output_dir, f"frame_{frame_no:05d}.png")
            send_cmd(sock, {"cmd": "screenshot", "path": out_path})

    # Step to the final frame if no event landed there.
    if current_frame < 3300:
        send_cmd(sock, {"cmd": "step", "n": 3300 - current_frame})

    sock.close()
    print(f"Captured {len(CAPTURE_FRAMES)} frames to {args.output_dir}")


if __name__ == "__main__":
    main()
