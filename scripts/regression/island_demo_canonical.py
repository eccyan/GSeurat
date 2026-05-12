"""Canonical island_demo walkthrough for regression diffing.

Run via: python3 scripts/regression/run_harness.py
Standalone: python3 scripts/regression/island_demo_canonical.py --output-dir <dir>

The engine MUST be running with --deterministic.  Frame-aligned input dispatch
ensures the same scenario produces deterministic pixels across runs.

# Capture methodology — settle-before-capture (Path A)

Apple Silicon's TBDR + MoltenVK introduces sub-frame schedule variance under
motion: tile-bin reductions, async-compute dispatches, and PBD wind RNG each
contribute small non-deterministic ordering that produces SSIM ~0.73–0.94
between two runs of the same deterministic scenario when frames are captured
mid-motion. (Phase 4b validation surfaced this — see
`project_harness_apple_silicon_methodology.md` in agent memory.)

To make `--self-check` reliable on the platform, every screenshot is preceded
by a 120-frame (2 s @ 60 Hz) idle settle: input cleared, PBD oscillations
damped, particles aged out. The player is stationary at capture time, the
only residual motion is NPC idle animation (which produces ~0.02 SSIM noise
that the harness threshold absorbs).

Trade-off: we no longer catch regressions that *only* manifest during motion
(e.g., a broken walk-anim blend). The settled snapshots still catch the
common regression classes — broken bone buffers, missing geometry, wrong
shader output, dispatch-ordering bugs that bleed into final pixels.
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

# Frames of idle stepping between input-clear and screenshot. Long enough for
# PBD tree oscillations to damp (~6% residual amplitude assuming ~0.95-per-step
# damping over 120 iterations) and ambient particles to age out of the frame.
SETTLE_FRAMES = 120

# Walkthrough stages. Each stage executes:
#   1. (optional) inject_key <movement_key, down=True>
#   2. step <walk_frames>   (engine sim runs while the key is "held")
#   3. clear_keys
#   4. step SETTLE_FRAMES   (settle — skipped for stage 0)
#   5. screenshot
#
# Format: (movement_key | None, walk_frames). walk_frames=0 means "no movement,
# just settle and capture — exercises NPC animation phase advance at this POI".
STAGES = [
    (None,        0),    # 0: spawn — pre-walk capture
    (GLFW_KEY_W, 300),   # 1: walked W 5 s — open meadow
    (GLFW_KEY_W, 120),   # 2: 2 s more W — approaching portal
    (GLFW_KEY_W, 120),   # 3: through portal
    (None,        0),    # 4: same position, NPC time advance
    (GLFW_KEY_W, 240),   # 5: 4 s W into forest
    (GLFW_KEY_W, 240),   # 6: deeper forest
    (GLFW_KEY_S, 240),   # 7: walked back S
    (GLFW_KEY_S, 240),   # 8: more S
    (GLFW_KEY_S, 240),   # 9: near return
    (None,        0),    # 10: NPC time advance
    (None,        0),    # 11: final NPC time advance
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

    current_frame = 0
    captures_taken = 0
    for stage_idx, (key, walk_frames) in enumerate(STAGES):
        # 1+2: drive the movement (if any) then 3: clear input
        if walk_frames > 0:
            if key is not None:
                send_cmd(sock, {"cmd": "inject_key", "key": key, "down": True})
            send_cmd(sock, {"cmd": "step", "n": walk_frames})
            current_frame += walk_frames
            if key is not None:
                send_cmd(sock, {"cmd": "clear_keys"})

        # 4: settle (skipped for stage 0 — fresh spawn already deterministic)
        if stage_idx > 0:
            send_cmd(sock, {"cmd": "step", "n": SETTLE_FRAMES})
            current_frame += SETTLE_FRAMES

        # 5: capture at the settled frame
        out_path = os.path.join(args.output_dir, f"frame_{current_frame:05d}.png")
        send_cmd(sock, {"cmd": "screenshot", "path": out_path})
        captures_taken += 1

    sock.close()
    print(f"Captured {captures_taken} frames to {args.output_dir} "
          f"(scenario length: {current_frame} frames)")


if __name__ == "__main__":
    main()
