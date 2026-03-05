#!/usr/bin/env python3
"""
Art Producer: Generate player sprite sheet via ComfyUI.

Generates character sprites for each animation state and direction,
downscales to 16x16, and assembles into the game's 64x192 player sheet
(4 cols x 12 rows: 4 frames x 3 states x 4 directions).

Usage:
    python3 tools/scripts/generate_player_sheet.py
"""

import json
import time
import urllib.request
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Install: pip install Pillow")
    raise SystemExit(1)

COMFYUI_URL = "http://localhost:8188"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "assets" / "textures" / "player_sheet.png"
TILE_SIZE = 16
COLS = 4  # 4 animation frames
ROWS = 12  # 3 states x 4 directions
STEPS = 15

# LoRA configuration (set to None to disable)
LORA_NAME = "PixelArtRedmond15V-PixelArt-PIXARFK.safetensors"
LORA_WEIGHT = 0.8
LORA_TRIGGER = "PixArFK"

NEGATIVE_PROMPT = (
    "smooth, realistic, 3d render, blurry, soft, high resolution, "
    "photorealistic, anti-aliasing, gradient, watercolor, watermark, text, signature"
)

# Row layout:
#  0: idle_down    1: idle_left    2: idle_right   3: idle_up
#  4: walk_down    5: walk_left    6: walk_right   7: walk_up
#  8: run_down     9: run_left    10: run_right   11: run_up

STATES = ["idle", "walk", "run"]
DIRECTIONS = ["down", "left", "right", "up"]

STATE_DESC = {
    "idle": "standing still, relaxed pose",
    "walk": "walking, mid-stride",
    "run": "running, dynamic pose, leaning forward",
}

DIR_DESC = {
    "down": "facing the camera, front view",
    "left": "facing left, side view",
    "right": "facing right, side view",
    "up": "facing away, back view",
}

CHARACTER_DESC = "fantasy RPG hero, young adventurer, brown hair, blue tunic, leather boots"


def build_workflow(prompt: str, negative: str, seed: int) -> dict:
    if LORA_NAME and LORA_TRIGGER:
        prompt = f"{LORA_TRIGGER}, {prompt}"

    model_ref = ["4", 0]
    clip_ref = ["4", 1]

    nodes = {
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "v1-5-pruned-emaonly.safetensors"},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
    }

    if LORA_NAME:
        nodes["10"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": LORA_NAME,
                "strength_model": LORA_WEIGHT,
                "strength_clip": LORA_WEIGHT,
                "model": ["4", 0],
                "clip": ["4", 1],
            },
        }
        model_ref = ["10", 0]
        clip_ref = ["10", 1]

    nodes.update({
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": clip_ref},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": clip_ref},
        },
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": STEPS,
                "cfg": 7,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1,
                "model": model_ref,
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "player_gen_", "images": ["8", 0]},
        },
    })

    return nodes


def submit_and_wait(prompt: str, seed: int, timeout: float = 600) -> Image.Image:
    workflow = build_workflow(prompt, NEGATIVE_PROMPT, seed)
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        prompt_id = json.loads(resp.read())["prompt_id"]

    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
                history = json.loads(resp.read())
            entry = history.get(prompt_id)
            if entry and entry["status"].get("completed"):
                if entry["status"].get("status_str") == "error":
                    raise RuntimeError(f"Generation error: {prompt_id}")
                for node_out in entry["outputs"].values():
                    imgs = node_out.get("images", [])
                    if imgs:
                        info = imgs[0]
                        url = (
                            f"{COMFYUI_URL}/view?"
                            f"filename={info['filename']}"
                            f"&subfolder={info['subfolder']}"
                            f"&type={info['type']}"
                        )
                        with urllib.request.urlopen(url) as r:
                            return Image.open(BytesIO(r.read())).convert("RGBA")
                raise RuntimeError("No images in output")
        except urllib.error.URLError:
            continue
    raise TimeoutError(f"Timed out for {prompt_id}")


def main():
    total = COLS * ROWS
    print(f"Art Producer: Generating {total} player sprite frames via ComfyUI")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Character: {CHARACTER_DESC}")
    print()

    try:
        with urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=5):
            pass
    except Exception as e:
        print(f"ERROR: Cannot reach ComfyUI: {e}")
        raise SystemExit(1)

    sheet = Image.new("RGBA", (COLS * TILE_SIZE, ROWS * TILE_SIZE), (0, 0, 0, 0))
    base_seed = 1000
    generated = 0

    for state_idx, state in enumerate(STATES):
        for dir_idx, direction in enumerate(DIRECTIONS):
            row = state_idx * len(DIRECTIONS) + dir_idx
            for frame in range(COLS):
                generated += 1
                seed = base_seed + row * COLS + frame

                prompt = (
                    f"{CHARACTER_DESC}, {STATE_DESC[state]}, {DIR_DESC[direction]}, "
                    f"animation frame {frame + 1} of 4, "
                    f"pixel art character sprite, 16x16, retro game, SNES style, "
                    f"single character centered, transparent background"
                )

                label = f"{state}_{direction} frame {frame}"
                print(f"[{generated}/{total}] Row {row} Col {frame}: {label}")

                try:
                    full_img = submit_and_wait(prompt, seed)
                    tile = full_img.resize((TILE_SIZE, TILE_SIZE), Image.NEAREST)
                    sheet.paste(tile, (frame * TILE_SIZE, row * TILE_SIZE))
                    print(f"  -> Done (seed={seed})")
                except Exception as e:
                    print(f"  -> FAILED: {e}")
                    continue

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(str(OUTPUT_PATH))
    print(f"\nPlayer sheet saved to {OUTPUT_PATH} ({COLS * TILE_SIZE}x{ROWS * TILE_SIZE})")


if __name__ == "__main__":
    main()
