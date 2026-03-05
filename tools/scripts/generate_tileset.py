#!/usr/bin/env python3
"""
Art Producer: Generate pixel art tiles via ComfyUI and assemble into tileset.

Talks to ComfyUI API (localhost:8188) to generate 512x512 images,
downscales each to 16x16 nearest-neighbor, and composites them into
the game's 128x48 tileset (8 cols x 3 rows).

Usage:
    python3 tools/scripts/generate_tileset.py
"""

import json
import time
import urllib.request
import urllib.error
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install Pillow")
    raise SystemExit(1)

COMFYUI_URL = "http://localhost:8188"
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "assets" / "textures" / "tileset.png"
TILE_SIZE = 16
COLS = 8
ROWS = 3
STEPS = 15  # fewer steps for CPU speed

# LoRA configuration (set to None to disable)
LORA_NAME = "PixelArtRedmond15V-PixelArt-PIXARFK.safetensors"
LORA_WEIGHT = 0.8
LORA_TRIGGER = "PixArFK"  # trigger token to prepend to prompts

# ── Tile definitions ─────────────────────────────────────────────────────────
# (col, row): prompt
# Matches the game's tileset layout:
#   Row 0: floor/ground tiles
#   Row 1: wall/obstacle tiles
#   Row 2: decoration/special tiles
TILE_PROMPTS = {
    # Row 0: floors
    (0, 0): "stone floor tile, top-down, gray cobblestone, worn texture, pixel art, 16x16, game asset",
    (1, 0): "dark stone wall tile, top-down, rough rock surface, pixel art, 16x16, game asset",
    # Row 0 cols 2-4: water animation frames
    (2, 0): "water tile, top-down, blue waves, calm pool, pixel art, 16x16, game asset",
    (3, 0): "water tile, top-down, blue ripples, slight wave, pixel art, 16x16, game asset",
    (4, 0): "water tile, top-down, blue water, wave crest, pixel art, 16x16, game asset",
    # Row 0 cols 5-7: lava animation frames
    (5, 0): "lava tile, top-down, glowing orange molten rock, pixel art, 16x16, game asset",
    (6, 0): "lava tile, top-down, bright orange flowing lava, pixel art, 16x16, game asset",
    (7, 0): "lava tile, top-down, red-orange magma bubbling, pixel art, 16x16, game asset",
    # Row 1: walls and torches
    (0, 1): "wall torch tile, side view, flickering flame on stone bracket, warm glow, pixel art, 16x16",
    (1, 1): "wall torch tile, side view, bright flame on stone bracket, ember sparks, pixel art, 16x16",
    (2, 1): "wooden door tile, front view, medieval oak door, iron studs, pixel art, 16x16, game asset",
    (3, 1): "treasure chest tile, top-down, wooden chest gold trim, closed, pixel art, 16x16, game asset",
    (4, 1): "grass floor tile, top-down, green grass, natural texture, pixel art, 16x16, game asset",
    (5, 1): "sand floor tile, top-down, warm beige sand, desert, pixel art, 16x16, game asset",
    (6, 1): "brick wall tile, top-down, red-brown medieval bricks, pixel art, 16x16, game asset",
    (7, 1): "ice floor tile, top-down, light blue frozen surface, crystal, pixel art, 16x16, game asset",
    # Row 2: decorations
    (0, 2): "barrel tile, top-down, wooden barrel, iron bands, pixel art, 16x16, game asset",
    (1, 2): "crate tile, top-down, wooden storage crate, pixel art, 16x16, game asset",
    (2, 2): "bookshelf tile, front view, filled bookcase, colorful spines, pixel art, 16x16, game asset",
    (3, 2): "potted plant tile, top-down, green fern in clay pot, pixel art, 16x16, game asset",
    (4, 2): "rug tile, top-down, red ornate carpet, gold pattern, pixel art, 16x16, game asset",
    (5, 2): "table tile, top-down, wooden round table, pixel art, 16x16, game asset",
    (6, 2): "bed tile, top-down, simple bed with blanket, pixel art, 16x16, game asset",
    (7, 2): "stairs tile, top-down, stone stairs going down, dungeon, pixel art, 16x16, game asset",
}

NEGATIVE_PROMPT = (
    "smooth, realistic, 3d render, blurry, soft, high resolution, "
    "photorealistic, anti-aliasing, gradient, watercolor, watermark, text, signature"
)


def build_workflow(prompt: str, negative: str, seed: int) -> dict:
    """Build a ComfyUI txt2img workflow JSON, optionally with LoRA."""
    # Prepend LoRA trigger word if configured
    if LORA_NAME and LORA_TRIGGER:
        prompt = f"{LORA_TRIGGER}, {prompt}"

    # Model output refs — will be rewired if LoRA is used
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

    # Insert LoRA loader between checkpoint and the rest
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
            "inputs": {"filename_prefix": "tileset_gen_", "images": ["8", 0]},
        },
    })

    return nodes


def submit_prompt(workflow: dict) -> str:
    """Submit workflow to ComfyUI, return prompt_id."""
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    return result["prompt_id"]


def poll_for_completion(prompt_id: str, timeout: float = 600) -> dict:
    """Poll /history/{id} until done. Return the history entry."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
                history = json.loads(resp.read())
        except urllib.error.URLError:
            continue
        entry = history.get(prompt_id)
        if not entry:
            continue
        if not entry["status"].get("completed", False):
            continue
        if entry["status"].get("status_str") == "error":
            raise RuntimeError(f"ComfyUI generation error: {prompt_id}")
        return entry
    raise TimeoutError(f"Timed out after {timeout}s waiting for {prompt_id}")


def fetch_image(entry: dict) -> Image.Image:
    """Download the first output image from a completed history entry."""
    for node_output in entry["outputs"].values():
        images = node_output.get("images", [])
        if images:
            img_info = images[0]
            url = (
                f"{COMFYUI_URL}/view?"
                f"filename={img_info['filename']}"
                f"&subfolder={img_info['subfolder']}"
                f"&type={img_info['type']}"
            )
            with urllib.request.urlopen(url) as resp:
                return Image.open(BytesIO(resp.read())).convert("RGBA")
    raise RuntimeError("No images in output")


def generate_tile(prompt: str, seed: int) -> Image.Image:
    """Generate a 512x512 image, downscale to 16x16 nearest-neighbor."""
    workflow = build_workflow(prompt, NEGATIVE_PROMPT, seed)
    prompt_id = submit_prompt(workflow)
    entry = poll_for_completion(prompt_id)
    full_img = fetch_image(entry)
    # Nearest-neighbor downscale to 16x16
    return full_img.resize((TILE_SIZE, TILE_SIZE), Image.NEAREST)


def main():
    print(f"Art Producer: Generating {len(TILE_PROMPTS)} tiles via ComfyUI")
    print(f"Output: {OUTPUT_PATH}")
    print(f"Steps per tile: {STEPS} (CPU mode)")
    print()

    # Check ComfyUI is reachable
    try:
        with urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=5):
            pass
    except Exception as e:
        print(f"ERROR: Cannot reach ComfyUI at {COMFYUI_URL}: {e}")
        print("Start it with: ./venv/bin/python main.py --cpu --listen --enable-cors-header '*'")
        raise SystemExit(1)

    # Create output tileset canvas
    tileset = Image.new("RGBA", (COLS * TILE_SIZE, ROWS * TILE_SIZE), (0, 0, 0, 0))

    base_seed = 42
    generated = 0
    total = len(TILE_PROMPTS)

    for (col, row), prompt in sorted(TILE_PROMPTS.items()):
        seed = base_seed + row * COLS + col
        generated += 1
        print(f"[{generated}/{total}] Tile ({col},{row}): {prompt[:60]}...")

        try:
            tile_img = generate_tile(prompt, seed)
            tileset.paste(tile_img, (col * TILE_SIZE, row * TILE_SIZE))
            print(f"  -> Done (seed={seed})")
        except Exception as e:
            print(f"  -> FAILED: {e}")
            # Leave tile transparent on failure
            continue

    # Save tileset
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tileset.save(str(OUTPUT_PATH))
    print(f"\nTileset saved to {OUTPUT_PATH} ({COLS * TILE_SIZE}x{ROWS * TILE_SIZE})")


if __name__ == "__main__":
    main()
