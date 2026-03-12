#!/usr/bin/env python3
"""
Debug round 5: Test the fixed 14-keypoint poses with spread hips.
"""
import json, time, urllib.request, urllib.parse, os, struct, zlib

COMFY_URL = "http://127.0.0.1:8188"
CONCEPT_IMAGE = "/Users/eccyan/dev/vulkan-game/assets/characters/protagonist/concept_right.png"
OUTPUT_DIR = "/Users/eccyan/dev/vulkan-game/tools/experiments/ipa-debug5-results"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def upload_image(filepath):
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
    return json.loads(urllib.request.urlopen(req).read())["name"]

def upload_bytes(png_bytes, name):
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
    return json.loads(urllib.request.urlopen(req).read())["name"]

def submit_workflow(workflow):
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFY_URL}/prompt", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())["prompt_id"]

def poll_completion(prompt_id, timeout=300):
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
                raise RuntimeError(f"Workflow failed: {json.dumps(entry.get('status', {}))}")
    raise TimeoutError(f"Timeout waiting for {prompt_id}")

def download_image(image_info, output_path):
    params = urllib.parse.urlencode({
        "filename": image_info["filename"],
        "subfolder": image_info.get("subfolder", ""),
        "type": image_info.get("type", "output"),
    })
    resp = urllib.request.urlopen(f"{COMFY_URL}/view?{params}")
    with open(output_path, "wb") as f:
        f.write(resp.read())

def render_openpose_14kp(keypoints, width=512, height=512):
    """Render 14-keypoint OpenPose skeleton on black background."""
    pixels = bytearray(width * height * 4)
    for i in range(width * height):
        pixels[i * 4 + 3] = 255  # opaque black
    LIMBS = [
        (0, 1, 255, 0, 0), (1, 2, 255, 85, 0), (2, 3, 255, 170, 0), (3, 4, 255, 255, 0),
        (1, 5, 0, 255, 0), (5, 6, 0, 255, 85), (6, 7, 0, 255, 170),
        (1, 8, 0, 255, 255), (8, 9, 0, 170, 255), (9, 10, 0, 85, 255),
        (1, 11, 0, 0, 255), (11, 12, 85, 0, 255), (12, 13, 170, 0, 255),
    ]
    def draw_circle(cx, cy, r, red, green, blue):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    px, py = int(cx + dx), int(cy + dy)
                    if 0 <= px < width and 0 <= py < height:
                        idx = (py * width + px) * 4
                        pixels[idx] = red; pixels[idx+1] = green; pixels[idx+2] = blue; pixels[idx+3] = 255
    def draw_line(x0, y0, x1, y1, red, green, blue, thickness=4):
        dx, dy = x1 - x0, y1 - y0
        steps = max(abs(int(dx)), abs(int(dy)), 1)
        for i in range(steps + 1):
            t = i / steps
            draw_circle(x0 + dx * t, y0 + dy * t, thickness, red, green, blue)
    scaled = [(kp[0] * width, kp[1] * height) if kp else None for kp in keypoints]
    for i0, i1, r, g, b in LIMBS:
        if i0 < len(scaled) and i1 < len(scaled) and scaled[i0] and scaled[i1]:
            draw_line(scaled[i0][0], scaled[i0][1], scaled[i1][0], scaled[i1][1], r, g, b, 4)
    for kp in scaled:
        if kp: draw_circle(kp[0], kp[1], 6, 255, 255, 255)
    raw_data = b""
    for y in range(height):
        raw_data += b"\x00" + bytes(pixels[y * width * 4:(y + 1) * width * 4])
    compressed = zlib.compress(raw_data)
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

# Updated RUN_RIGHT f0 with spread hips (matching pipeline code)
RUN_RIGHT_F0_FIXED = [
    (0.58, 0.16), (0.50, 0.25), (0.48, 0.28), (0.38, 0.34), (0.32, 0.40),
    (0.52, 0.28), (0.62, 0.34), (0.68, 0.40),
    (0.45, 0.45), (0.60, 0.60), (0.66, 0.78),
    (0.55, 0.45), (0.42, 0.60), (0.36, 0.74),
]

PROMPT = "facing right, right side profile, looking right, male knight, mid-age, no helmet, exposed face, brown short hair, plate armor, run pose, full body, solo, single character, centered, plain white background, solid color background"
NEGATIVE = "blurry, smooth, realistic, 3d render, photorealistic, watermark, text, signature, noise, extra limbs, deformed, partial body, cropped, helmet, visor, headgear, multiple characters, busy background, frame, border, circular frame, vignette, detailed background, room, interior, exterior, furniture, floor, wall, ceiling, sky, ground, environment"

def main():
    print("Uploading concept_right.png...")
    concept_name = upload_image(CONCEPT_IMAGE)

    print("Rendering fixed 14kp pose (spread hips)...")
    pose_png = render_openpose_14kp(RUN_RIGHT_F0_FIXED)
    pose_name = upload_bytes(pose_png, "debug5_pose_f0.png")
    with open(os.path.join(OUTPUT_DIR, "pose_f0.png"), "wb") as f:
        f.write(pose_png)

    SEED = 42

    # Test: IPA + OpenPose with fixed pose
    print("\n--- Test: IPA + OpenPose (fixed spread hips) ---")
    workflow = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "AnythingV5_v5PrtRE.safetensors"}},
        "40": {"class_type": "LoadImage", "inputs": {"image": concept_name}},
        "45": {"class_type": "LoadImage", "inputs": {"image": pose_name}},
        "41": {"class_type": "IPAdapterUnifiedLoader", "inputs": {"preset": "PLUS (high strength)", "model": ["4", 0]}},
        "42": {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "weight": 0.7, "weight_type": "linear",
                "combine_embeds": "concat", "start_at": 0.0, "end_at": 1.0,
                "embeds_scaling": "V only",
                "model": ["41", 0], "ipadapter": ["41", 1], "image": ["40", 0],
            },
        },
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEGATIVE, "clip": ["4", 1]}},
        "46": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "control_v11p_sd15_openpose.pth"}},
        "47": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["6", 0], "negative": ["7", 0],
                "control_net": ["46", 0], "image": ["45", 0],
                "strength": 0.8, "start_percent": 0.0, "end_percent": 1.0,
            },
        },
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 512, "height": 512, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": SEED, "steps": 30, "cfg": 7,
                "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
                "model": ["42", 0], "positive": ["47", 0], "negative": ["47", 1],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "debug5", "images": ["8", 0]}},
    }
    try:
        pid = submit_workflow(workflow)
        entry = poll_completion(pid)
        for nid, out in entry["outputs"].items():
            if "images" in out:
                for img in out["images"]:
                    download_image(img, os.path.join(OUTPUT_DIR, "test_ipa_openpose.png"))
                    print("  Saved: test_ipa_openpose.png")
    except Exception as e:
        print(f"  ERROR: {e}")

    print(f"\nDone! Check: {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
