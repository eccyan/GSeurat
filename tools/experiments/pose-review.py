#!/usr/bin/env python3
"""
Render all pose templates for visual review.
Outputs a grid image per animation state (idle, walk, run) x direction (down, up, right, left).
"""
import struct, zlib, os

OUTPUT_DIR = "/Users/eccyan/dev/vulkan-game/tools/experiments/pose-review"
os.makedirs(OUTPUT_DIR, exist_ok=True)

LIMBS = [
    (0, 1, (255, 0, 0)),     # nose-neck
    (1, 2, (255, 85, 0)),    # neck-r_shoulder
    (2, 3, (255, 170, 0)),   # r_shoulder-r_elbow
    (3, 4, (255, 255, 0)),   # r_elbow-r_wrist
    (1, 5, (0, 255, 0)),     # neck-l_shoulder
    (5, 6, (0, 255, 85)),    # l_shoulder-l_elbow
    (6, 7, (0, 255, 170)),   # l_elbow-l_wrist
    (1, 8, (0, 255, 255)),   # neck-r_hip
    (8, 9, (0, 170, 255)),   # r_hip-r_knee
    (9, 10, (0, 85, 255)),   # r_knee-r_ankle
    (1, 11, (0, 0, 255)),    # neck-l_hip
    (11, 12, (85, 0, 255)),  # l_hip-l_knee
    (12, 13, (170, 0, 255)), # l_knee-l_ankle
]

KP_COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0),
    (170, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170),
    (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255),
    (85, 0, 255), (170, 0, 255),
]

# ---- Pose data (copied from pose-templates.ts) ----

IDLE_DOWN = [
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.34,0.40),(0.33,0.50),
     (0.62,0.27),(0.66,0.40),(0.67,0.50),
     (0.43,0.51),(0.43,0.67),(0.43,0.82),
     (0.57,0.51),(0.57,0.67),(0.57,0.82)],
    [(0.50,0.15),(0.50,0.24),(0.38,0.28),(0.34,0.41),(0.33,0.52),
     (0.62,0.28),(0.66,0.41),(0.67,0.52),
     (0.43,0.52),(0.43,0.67),(0.43,0.82),
     (0.57,0.52),(0.57,0.67),(0.57,0.82)],
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.34,0.40),(0.33,0.50),
     (0.62,0.27),(0.66,0.40),(0.67,0.50),
     (0.43,0.51),(0.43,0.67),(0.43,0.82),
     (0.57,0.51),(0.57,0.67),(0.57,0.82)],
    [(0.50,0.14),(0.50,0.23),(0.38,0.26),(0.34,0.39),(0.33,0.49),
     (0.62,0.26),(0.66,0.39),(0.67,0.49),
     (0.43,0.51),(0.43,0.67),(0.43,0.82),
     (0.57,0.51),(0.57,0.67),(0.57,0.82)],
]

WALK_DOWN = [
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.32,0.38),(0.30,0.48),
     (0.62,0.27),(0.68,0.38),(0.70,0.48),
     (0.43,0.51),(0.40,0.66),(0.38,0.82),
     (0.57,0.51),(0.58,0.65),(0.60,0.78)],
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.36,0.40),(0.38,0.50),
     (0.62,0.27),(0.64,0.40),(0.62,0.50),
     (0.43,0.51),(0.44,0.67),(0.44,0.82),
     (0.57,0.51),(0.56,0.67),(0.56,0.82)],
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.32,0.38),(0.30,0.48),
     (0.62,0.27),(0.68,0.38),(0.70,0.48),
     (0.43,0.51),(0.42,0.65),(0.40,0.78),
     (0.57,0.51),(0.58,0.66),(0.60,0.82)],
    [(0.50,0.15),(0.50,0.24),(0.38,0.27),(0.36,0.40),(0.38,0.50),
     (0.62,0.27),(0.64,0.40),(0.62,0.50),
     (0.43,0.51),(0.44,0.67),(0.44,0.82),
     (0.57,0.51),(0.56,0.67),(0.56,0.82)],
]

RUN_DOWN = [
    [(0.50,0.16),(0.50,0.25),(0.38,0.28),(0.30,0.36),(0.26,0.44),
     (0.62,0.28),(0.70,0.36),(0.74,0.44),
     (0.43,0.51),(0.36,0.64),(0.32,0.80),
     (0.57,0.51),(0.60,0.62),(0.64,0.72)],
    [(0.50,0.18),(0.50,0.27),(0.38,0.30),(0.32,0.40),(0.30,0.50),
     (0.62,0.30),(0.68,0.40),(0.70,0.50),
     (0.43,0.53),(0.40,0.67),(0.40,0.82),
     (0.57,0.53),(0.58,0.66),(0.58,0.78)],
    [(0.50,0.16),(0.50,0.25),(0.38,0.28),(0.30,0.36),(0.26,0.44),
     (0.62,0.28),(0.70,0.36),(0.74,0.44),
     (0.43,0.51),(0.40,0.62),(0.36,0.72),
     (0.57,0.51),(0.64,0.64),(0.68,0.80)],
    [(0.50,0.18),(0.50,0.27),(0.38,0.30),(0.32,0.40),(0.30,0.50),
     (0.62,0.30),(0.68,0.40),(0.70,0.50),
     (0.43,0.53),(0.42,0.66),(0.42,0.78),
     (0.57,0.53),(0.58,0.67),(0.58,0.82)],
]

IDLE_RIGHT = [
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.40,0.34),(0.40,0.44),
     (0.56,0.22),(0.58,0.34),(0.58,0.44),
     (0.45,0.45),(0.45,0.63),(0.45,0.78),
     (0.55,0.45),(0.55,0.63),(0.55,0.78)],
    [(0.55,0.12),(0.50,0.22),(0.44,0.23),(0.40,0.35),(0.40,0.46),
     (0.56,0.23),(0.58,0.35),(0.58,0.46),
     (0.45,0.46),(0.45,0.63),(0.45,0.78),
     (0.55,0.46),(0.55,0.63),(0.55,0.78)],
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.40,0.34),(0.40,0.44),
     (0.56,0.22),(0.58,0.34),(0.58,0.44),
     (0.45,0.45),(0.45,0.63),(0.45,0.78),
     (0.55,0.45),(0.55,0.63),(0.55,0.78)],
    [(0.55,0.11),(0.50,0.21),(0.44,0.21),(0.40,0.33),(0.40,0.43),
     (0.56,0.21),(0.58,0.33),(0.58,0.43),
     (0.45,0.45),(0.45,0.63),(0.45,0.78),
     (0.55,0.45),(0.55,0.63),(0.55,0.78)],
]

WALK_RIGHT = [
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.38,0.30),(0.36,0.38),
     (0.56,0.22),(0.62,0.30),(0.64,0.38),
     (0.45,0.45),(0.56,0.60),(0.60,0.78),
     (0.55,0.45),(0.44,0.60),(0.40,0.78)],
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.42,0.34),(0.44,0.44),
     (0.56,0.22),(0.56,0.34),(0.54,0.44),
     (0.45,0.45),(0.48,0.63),(0.48,0.78),
     (0.55,0.45),(0.52,0.63),(0.52,0.78)],
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.58,0.30),(0.64,0.38),
     (0.56,0.22),(0.38,0.30),(0.36,0.38),
     (0.45,0.45),(0.44,0.60),(0.40,0.78),
     (0.55,0.45),(0.56,0.60),(0.60,0.78)],
    [(0.55,0.12),(0.50,0.22),(0.44,0.22),(0.56,0.34),(0.54,0.44),
     (0.56,0.22),(0.42,0.34),(0.44,0.44),
     (0.45,0.45),(0.48,0.63),(0.48,0.78),
     (0.55,0.45),(0.52,0.63),(0.52,0.78)],
]

RUN_RIGHT = [
    # f0: left leg forward, right arm forward (cross-lateral)
    [(0.52,0.12),(0.50,0.22),(0.44,0.22),(0.62,0.30),(0.58,0.38),
     (0.56,0.22),(0.38,0.30),(0.40,0.38),
     (0.45,0.45),(0.38,0.60),(0.42,0.78),
     (0.55,0.45),(0.65,0.58),(0.62,0.78)],
    [(0.52,0.14),(0.50,0.24),(0.44,0.24),(0.50,0.32),(0.55,0.28),
     (0.56,0.24),(0.48,0.32),(0.44,0.28),
     (0.45,0.47),(0.44,0.62),(0.44,0.78),
     (0.55,0.47),(0.56,0.62),(0.56,0.78)],
    # f2: right leg forward, left arm forward (cross-lateral)
    [(0.52,0.12),(0.50,0.22),(0.44,0.22),(0.38,0.30),(0.40,0.38),
     (0.56,0.22),(0.62,0.30),(0.58,0.38),
     (0.50,0.45),(0.60,0.58),(0.58,0.78),
     (0.50,0.45),(0.40,0.60),(0.42,0.78)],
    [(0.52,0.14),(0.50,0.24),(0.44,0.24),(0.48,0.32),(0.44,0.28),
     (0.56,0.24),(0.50,0.32),(0.55,0.28),
     (0.45,0.47),(0.44,0.62),(0.44,0.78),
     (0.55,0.47),(0.56,0.62),(0.56,0.78)],
]

def mirrorX(pose):
    return [(1 - kp[0], kp[1]) if kp else None for kp in pose]

def toUp(pose):
    p = list(pose)
    p[0] = None
    return p

ALL_ANIMS = {
    "idle_down": IDLE_DOWN,
    "idle_up": [toUp(p) for p in IDLE_DOWN],
    "idle_right": IDLE_RIGHT,
    "idle_left": [mirrorX(p) for p in IDLE_RIGHT],
    "walk_down": WALK_DOWN,
    "walk_up": [toUp(p) for p in WALK_DOWN],
    "walk_right": WALK_RIGHT,
    "walk_left": [mirrorX(p) for p in WALK_RIGHT],
    "run_down": RUN_DOWN,
    "run_up": [toUp(p) for p in RUN_DOWN],
    "run_right": RUN_RIGHT,
    "run_left": [mirrorX(p) for p in RUN_RIGHT],
}

def draw_circle(pixels, w, h, cx, cy, r, rgb):
    for dy in range(-r, r+1):
        for dx in range(-r, r+1):
            if dx*dx + dy*dy <= r*r:
                px, py = int(cx+dx), int(cy+dy)
                if 0 <= px < w and 0 <= py < h:
                    idx = (py*w+px)*4
                    pixels[idx]=rgb[0]; pixels[idx+1]=rgb[1]; pixels[idx+2]=rgb[2]; pixels[idx+3]=255

def draw_line(pixels, w, h, x0, y0, x1, y1, rgb, thickness=3):
    dx, dy = x1-x0, y1-y0
    steps = max(abs(int(dx)), abs(int(dy)), 1)
    for i in range(steps+1):
        t = i/steps
        draw_circle(pixels, w, h, x0+dx*t, y0+dy*t, thickness, rgb)

def render_pose(pose, size=200):
    pixels = bytearray(size*size*4)
    # dark gray background
    for i in range(size*size):
        pixels[i*4]=20; pixels[i*4+1]=20; pixels[i*4+2]=30; pixels[i*4+3]=255
    for i0, i1, rgb in LIMBS:
        if i0 < len(pose) and i1 < len(pose) and pose[i0] and pose[i1]:
            a, b = pose[i0], pose[i1]
            draw_line(pixels, size, size, a[0]*size, a[1]*size, b[0]*size, b[1]*size, rgb, 3)
    for i, kp in enumerate(pose):
        if kp:
            draw_circle(pixels, size, size, kp[0]*size, kp[1]*size, 4, KP_COLORS[i % len(KP_COLORS)])
    return pixels

def render_label(text, w, h):
    """Simple text label (just colored background with no real text rendering)."""
    pixels = bytearray(w*h*4)
    for i in range(w*h):
        pixels[i*4]=40; pixels[i*4+1]=40; pixels[i*4+2]=60; pixels[i*4+3]=255
    return pixels

def make_png(pixels, w, h):
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes(pixels[y*w*4:(y+1)*w*4])
    compressed = zlib.compress(raw)
    def chunk(t, d):
        c = t+d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

def compose_strip(poses, cell_size=200):
    """Render 4 frames side by side."""
    n = len(poses)
    w = cell_size * n
    h = cell_size
    pixels = bytearray(w*h*4)
    for f, pose in enumerate(poses):
        frame_pixels = render_pose(pose, cell_size)
        for y in range(cell_size):
            src_start = y*cell_size*4
            dst_start = (y*w + f*cell_size)*4
            pixels[dst_start:dst_start+cell_size*4] = frame_pixels[src_start:src_start+cell_size*4]
    return make_png(pixels, w, h)

def main():
    cell = 200
    for name, frames in ALL_ANIMS.items():
        png = compose_strip(frames, cell)
        path = os.path.join(OUTPUT_DIR, f"{name}.png")
        with open(path, "wb") as f:
            f.write(png)
        print(f"Saved {name} ({len(frames)} frames)")
    print(f"\nAll poses saved to {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
