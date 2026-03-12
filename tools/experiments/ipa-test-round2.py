#!/usr/bin/env python3
"""
IP-Adapter + OpenPose experiment round 2.
Tests the winning parameters (#04: weak input, w=0.7, cfg=7) with pose control.
Uses 4 run_right poses to simulate actual animation generation.
"""

import json
import time
import urllib.request
import urllib.parse
import os
import math

COMFY_URL = "http://127.0.0.1:8188"
CONCEPT_IMAGE = "/Users/eccyan/dev/vulkan-game/assets/characters/protagonist/concept_right.png"
OUTPUT_DIR = "/Users/eccyan/dev/vulkan-game/tools/experiments/ipa-results-round2"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def upload_image(filepath: str) -> str:
    boundary = "----PythonBoundary"
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        file_data = f.read()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{COMFY_URL}/upload/image", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())["name"]


def upload_bytes(png_bytes: bytes, name: str) -> str:
    boundary = "----PythonBoundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + png_bytes + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{COMFY_URL}/upload/image", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())["name"]


def submit_workflow(workflow: dict) -> str:
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFY_URL}/prompt", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())["prompt_id"]


def poll_completion(prompt_id: str, timeout: int = 300) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        resp = urllib.request.urlopen(f"{COMFY_URL}/history/{prompt_id}")
        history = json.loads(resp.read())
        if prompt_id in history:
            entry = history[prompt_id]
            if entry.get("status", {}).get("completed", False):
                return entry
            if entry.get("status", {}).get("status_str") == "error":
                raise RuntimeError(f"Workflow failed: {entry}")
    raise TimeoutError(f"Timeout waiting for {prompt_id}")


def download_image(image_info: dict, output_path: str):
    params = urllib.parse.urlencode({
        "filename": image_info["filename"],
        "subfolder": image_info.get("subfolder", ""),
        "type": image_info.get("type", "output"),
    })
    resp = urllib.request.urlopen(f"{COMFY_URL}/view?{params}")
    with open(output_path, "wb") as f:
        f.write(resp.read())


def render_openpose_png(keypoints: list, width: int = 512, height: int = 512) -> bytes:
    """Render OpenPose skeleton to PNG using PIL-like approach with raw bytes."""
    # Use a simple approach: create a black image and draw colored lines
    # We'll use the struct/zlib approach for minimal PNG generation
    import struct
    import zlib

    # Create RGBA pixel data (black background)
    pixels = bytearray(width * height * 4)

    # OpenPose limb connections: (from_idx, to_idx, R, G, B)
    LIMBS = [
        (0, 1, 255, 0, 0),      # nose -> neck (red)
        (1, 2, 255, 85, 0),     # neck -> r_shoulder (orange)
        (2, 3, 255, 170, 0),    # r_shoulder -> r_elbow
        (3, 4, 255, 255, 0),    # r_elbow -> r_wrist
        (1, 5, 0, 255, 0),      # neck -> l_shoulder (green)
        (5, 6, 0, 255, 85),     # l_shoulder -> l_elbow
        (6, 7, 0, 255, 170),    # l_elbow -> l_wrist
        (1, 8, 0, 255, 255),    # neck -> r_hip (cyan)
        (8, 9, 0, 170, 255),    # r_hip -> r_knee
        (9, 10, 0, 85, 255),    # r_knee -> r_ankle
        (1, 11, 0, 0, 255),     # neck -> l_hip (blue)
        (11, 12, 85, 0, 255),   # l_hip -> l_knee
        (12, 13, 170, 0, 255),  # l_knee -> l_ankle
    ]

    def draw_circle(cx, cy, r, red, green, blue):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    px, py = int(cx + dx), int(cy + dy)
                    if 0 <= px < width and 0 <= py < height:
                        idx = (py * width + px) * 4
                        pixels[idx] = red
                        pixels[idx + 1] = green
                        pixels[idx + 2] = blue
                        pixels[idx + 3] = 255

    def draw_line(x0, y0, x1, y1, red, green, blue, thickness=3):
        dx = x1 - x0
        dy = y1 - y0
        steps = max(abs(int(dx)), abs(int(dy)), 1)
        for i in range(steps + 1):
            t = i / steps
            x = x0 + dx * t
            y = y0 + dy * t
            draw_circle(x, y, thickness, red, green, blue)

    # Scale keypoints to pixel coords
    scaled = []
    for kp in keypoints:
        if kp is None:
            scaled.append(None)
        else:
            scaled.append((kp[0] * width, kp[1] * height))

    # Draw limbs
    for i0, i1, r, g, b in LIMBS:
        if i0 < len(scaled) and i1 < len(scaled):
            p0, p1 = scaled[i0], scaled[i1]
            if p0 is not None and p1 is not None:
                draw_line(p0[0], p0[1], p1[0], p1[1], r, g, b, 3)

    # Draw keypoints
    COLORS = [
        (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0),
        (170, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170),
        (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255),
        (85, 0, 255), (170, 0, 255),
    ]
    for i, kp in enumerate(scaled):
        if kp is not None:
            c = COLORS[i % len(COLORS)]
            draw_circle(kp[0], kp[1], 5, c[0], c[1], c[2])

    # Encode as PNG
    raw_data = b""
    for y in range(height):
        raw_data += b"\x00"  # filter byte
        offset = y * width * 4
        raw_data += bytes(pixels[offset:offset + width * 4])

    compressed = zlib.compress(raw_data)

    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack(">I", len(data)) + chunk + struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += make_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += make_chunk(b"IDAT", compressed)
    png += make_chunk(b"IEND", b"")
    return png


# Run right poses (14 keypoints: nose, neck, r_shoulder, r_elbow, r_wrist,
# l_shoulder, l_elbow, l_wrist, r_hip, r_knee, r_ankle, l_hip, l_knee, l_ankle)
# Normalized 0-1 coordinates. Character facing RIGHT.
RUN_RIGHT_POSES = [
    # Frame 0: left foot extended forward
    [
        (0.52, 0.12),  # nose
        (0.50, 0.22),  # neck
        (0.44, 0.22),  # r_shoulder (back)
        (0.38, 0.30),  # r_elbow
        (0.40, 0.38),  # r_wrist
        (0.56, 0.22),  # l_shoulder (front)
        (0.62, 0.30),  # l_elbow
        (0.58, 0.38),  # l_wrist
        (0.45, 0.45),  # r_hip
        (0.38, 0.60),  # r_knee (back leg)
        (0.42, 0.78),  # r_ankle
        (0.55, 0.45),  # l_hip
        (0.65, 0.58),  # l_knee (front leg extended)
        (0.62, 0.78),  # l_ankle
    ],
    # Frame 1: both feet off ground (midair)
    [
        (0.52, 0.14),  # nose
        (0.50, 0.24),  # neck
        (0.44, 0.24),  # r_shoulder
        (0.50, 0.32),  # r_elbow (forward swing)
        (0.55, 0.28),  # r_wrist
        (0.56, 0.24),  # l_shoulder
        (0.48, 0.32),  # l_elbow (back swing)
        (0.44, 0.28),  # l_wrist
        (0.45, 0.47),  # r_hip
        (0.52, 0.60),  # r_knee
        (0.50, 0.76),  # r_ankle
        (0.55, 0.47),  # l_hip
        (0.48, 0.60),  # l_knee
        (0.50, 0.76),  # l_ankle
    ],
    # Frame 2: right foot extended forward
    [
        (0.52, 0.12),  # nose
        (0.50, 0.22),  # neck
        (0.44, 0.22),  # r_shoulder
        (0.50, 0.30),  # r_elbow (forward)
        (0.56, 0.26),  # r_wrist
        (0.56, 0.22),  # l_shoulder
        (0.50, 0.30),  # l_elbow (back)
        (0.44, 0.34),  # l_wrist
        (0.45, 0.45),  # r_hip
        (0.58, 0.58),  # r_knee (front leg extended)
        (0.60, 0.78),  # r_ankle
        (0.55, 0.45),  # l_hip
        (0.42, 0.60),  # l_knee (back leg)
        (0.40, 0.78),  # l_ankle
    ],
    # Frame 3: both feet off ground (midair, opposite arms)
    [
        (0.52, 0.14),  # nose
        (0.50, 0.24),  # neck
        (0.44, 0.24),  # r_shoulder
        (0.42, 0.32),  # r_elbow (back swing)
        (0.44, 0.28),  # r_wrist
        (0.56, 0.24),  # l_shoulder
        (0.58, 0.32),  # l_elbow (forward swing)
        (0.56, 0.28),  # l_wrist
        (0.45, 0.47),  # r_hip
        (0.48, 0.60),  # r_knee
        (0.50, 0.76),  # r_ankle
        (0.55, 0.47),  # l_hip
        (0.52, 0.60),  # l_knee
        (0.50, 0.76),  # l_ankle
    ],
]

NEGATIVE = "blurry, smooth, realistic, 3d render, photorealistic, watermark, text, signature, noise, extra limbs, deformed, partial body, cropped, helmet, visor, headgear, multiple characters, busy background, frame, border, circular frame, vignette"
PROMPT = "facing right, right side profile, looking right, male knight, mid-age, no helmet, exposed face, brown short hair, plate armor, run pose, full body, solo, single character, centered, plain white background, solid color background"

SEED = 42


def build_ipa_pose_workflow(
    concept_name: str,
    pose_name: str,
    prompt: str,
    negative: str,
    ip_weight: float,
    weight_type: str,
    embeds_scaling: str,
    start_at: float,
    end_at: float,
    cfg: float,
    steps: int,
    seed: int,
    pose_strength: float = 0.8,
    checkpoint: str = "AnythingV5_v5PrtRE.safetensors",
) -> dict:
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "40": {"class_type": "LoadImage", "inputs": {"image": concept_name}},
        "45": {"class_type": "LoadImage", "inputs": {"image": pose_name}},
        "41": {"class_type": "IPAdapterUnifiedLoader", "inputs": {"preset": "PLUS (high strength)", "model": ["4", 0]}},
        "42": {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "weight": ip_weight, "weight_type": weight_type,
                "combine_embeds": "concat", "start_at": start_at, "end_at": end_at,
                "embeds_scaling": embeds_scaling,
                "model": ["41", 0], "ipadapter": ["41", 1], "image": ["40", 0],
            },
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "46": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "control_v11p_sd15_openpose.pth"}},
        "47": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["6", 0], "negative": ["7", 0],
                "control_net": ["46", 0], "image": ["45", 0],
                "strength": pose_strength, "start_percent": 0.0, "end_percent": 1.0,
            },
        },
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
                "model": ["42", 0], "positive": ["47", 0], "negative": ["47", 1],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "ipa_pose_test", "images": ["8", 0]}},
    }


# Experiments: test the top 3 winners from round 1, now with OpenPose
CONFIGS = [
    {
        "name": "A_weakinput_w07_cfg7",
        "ip_weight": 0.7, "weight_type": "weak input",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0, "end_at": 1.0, "cfg": 7,
    },
    {
        "name": "B_linear_w09_cfg4",
        "ip_weight": 0.9, "weight_type": "linear",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0, "end_at": 0.85, "cfg": 4,
    },
    {
        "name": "C_linear_Vonly_w07_cfg7",
        "ip_weight": 0.7, "weight_type": "linear",
        "embeds_scaling": "V only",
        "start_at": 0.0, "end_at": 1.0, "cfg": 7,
    },
]


def main():
    print("Uploading concept art...")
    concept_name = upload_image(CONCEPT_IMAGE)
    print(f"  Uploaded as: {concept_name}")

    # Render and upload pose images
    print("Rendering pose skeletons...")
    pose_names = []
    for i, pose in enumerate(RUN_RIGHT_POSES):
        png = render_openpose_png(pose)
        name = upload_bytes(png, f"pose_run_right_{i}.png")
        pose_names.append(name)
        # Also save locally for reference
        with open(os.path.join(OUTPUT_DIR, f"pose_f{i}.png"), "wb") as f:
            f.write(png)
        print(f"  Pose f{i}: {name}")

    for config in CONFIGS:
        cname = config["name"]
        print(f"\n{'='*60}")
        print(f"Config: {cname}")
        print(f"  weight={config['ip_weight']}, type={config['weight_type']}, embeds={config['embeds_scaling']}")
        print(f"  start={config['start_at']}, end={config['end_at']}, cfg={config['cfg']}")

        for fi in range(4):
            frame_seed = SEED + fi
            print(f"  Frame {fi} (seed={frame_seed})...")

            workflow = build_ipa_pose_workflow(
                concept_name=concept_name,
                pose_name=pose_names[fi],
                prompt=PROMPT,
                negative=NEGATIVE,
                ip_weight=config["ip_weight"],
                weight_type=config["weight_type"],
                embeds_scaling=config["embeds_scaling"],
                start_at=config["start_at"],
                end_at=config["end_at"],
                cfg=config["cfg"],
                steps=30,
                seed=frame_seed,
            )

            try:
                prompt_id = submit_workflow(workflow)
                entry = poll_completion(prompt_id)
                for node_id, output in entry["outputs"].items():
                    if "images" in output:
                        for img in output["images"]:
                            out_path = os.path.join(OUTPUT_DIR, f"{cname}_f{fi}.png")
                            download_image(img, out_path)
                            print(f"    Saved: {cname}_f{fi}.png")
            except Exception as e:
                print(f"    ERROR: {e}")

    print(f"\n{'='*60}")
    print(f"Round 2 complete! Results in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
