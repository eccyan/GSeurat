#!/usr/bin/env python3
"""
IP-Adapter experiment: test different parameters with the right-facing concept art.
Generates images directly via ComfyUI API and saves to output directory.
"""

import json
import time
import urllib.request
import urllib.parse
import os
import shutil

COMFY_URL = "http://127.0.0.1:8188"
CONCEPT_IMAGE = "/Users/eccyan/dev/vulkan-game/assets/characters/protagonist/concept_right.png"
OUTPUT_DIR = "/Users/eccyan/dev/vulkan-game/tools/experiments/ipa-results"

os.makedirs(OUTPUT_DIR, exist_ok=True)


def upload_image(filepath: str) -> str:
    """Upload an image to ComfyUI and return the filename."""
    import mimetypes
    boundary = "----PythonBoundary"
    filename = os.path.basename(filepath)
    mime_type = mimetypes.guess_type(filepath)[0] or "image/png"

    with open(filepath, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        f"{COMFY_URL}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    return result["name"]


def submit_workflow(workflow: dict) -> str:
    """Submit a workflow and return the prompt_id."""
    data = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{COMFY_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
    return result["prompt_id"]


def poll_completion(prompt_id: str, timeout: int = 300) -> dict:
    """Poll until the prompt completes, return the history entry."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        url = f"{COMFY_URL}/history/{prompt_id}"
        resp = urllib.request.urlopen(url)
        history = json.loads(resp.read())
        if prompt_id in history:
            entry = history[prompt_id]
            if entry.get("status", {}).get("completed", False):
                return entry
            status_str = entry.get("status", {}).get("status_str", "")
            if status_str == "error":
                raise RuntimeError(f"Workflow failed: {entry}")
    raise TimeoutError(f"Prompt {prompt_id} did not complete within {timeout}s")


def download_image(image_info: dict, output_path: str):
    """Download a generated image from ComfyUI."""
    params = urllib.parse.urlencode({
        "filename": image_info["filename"],
        "subfolder": image_info.get("subfolder", ""),
        "type": image_info.get("type", "output"),
    })
    url = f"{COMFY_URL}/view?{params}"
    resp = urllib.request.urlopen(url)
    with open(output_path, "wb") as f:
        f.write(resp.read())


def build_ipa_workflow(
    concept_image_name: str,
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
    preset: str = "PLUS (high strength)",
    checkpoint: str = "AnythingV5_v5PrtRE.safetensors",
) -> dict:
    """Build a txt2img + IP-Adapter workflow (no ControlNet)."""
    return {
        # Checkpoint
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint},
        },
        # Empty latent
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
        # Load concept image
        "40": {
            "class_type": "LoadImage",
            "inputs": {"image": concept_image_name},
        },
        # IP-Adapter Unified Loader
        "41": {
            "class_type": "IPAdapterUnifiedLoader",
            "inputs": {"preset": preset, "model": ["4", 0]},
        },
        # IP-Adapter Apply
        "42": {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "weight": ip_weight,
                "weight_type": weight_type,
                "combine_embeds": "concat",
                "start_at": start_at,
                "end_at": end_at,
                "embeds_scaling": embeds_scaling,
                "model": ["41", 0],
                "ipadapter": ["41", 1],
                "image": ["40", 0],
            },
        },
        # Positive CLIP
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["4", 1]},
        },
        # Negative CLIP
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["4", 1]},
        },
        # KSampler
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["42", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        # VAEDecode
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        # Save
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "ipa_test", "images": ["8", 0]},
        },
    }


# ── Experiment matrix ──
EXPERIMENTS = [
    # Experiment 1: Baseline — moderate weight, linear
    {
        "name": "01_baseline_w07_linear_cfg7",
        "ip_weight": 0.7,
        "weight_type": "linear",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 1.0,
        "cfg": 7,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 2: Lower weight to let prompt control direction
    {
        "name": "02_low_w05_linear_cfg7",
        "ip_weight": 0.5,
        "weight_type": "linear",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 1.0,
        "cfg": 7,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 3: Ease out — strong early, tapers
    {
        "name": "03_w07_easeout_cfg5",
        "ip_weight": 0.7,
        "weight_type": "ease out",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 0.85,
        "cfg": 5,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 4: Weak input — reduces layout/composition influence
    {
        "name": "04_w07_weakinput_cfg7",
        "ip_weight": 0.7,
        "weight_type": "weak input",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 1.0,
        "cfg": 7,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 5: High weight with low CFG
    {
        "name": "05_high_w09_linear_cfg4",
        "ip_weight": 0.9,
        "weight_type": "linear",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 0.85,
        "cfg": 4,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 6: V only embeds scaling (lighter touch)
    {
        "name": "06_w07_linear_Vonly_cfg7",
        "ip_weight": 0.7,
        "weight_type": "linear",
        "embeds_scaling": "V only",
        "start_at": 0.0,
        "end_at": 1.0,
        "cfg": 7,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 7: Style transfer weight type
    {
        "name": "07_w07_styletransfer_cfg7",
        "ip_weight": 0.7,
        "weight_type": "style transfer",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.0,
        "end_at": 1.0,
        "cfg": 7,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
    # Experiment 8: Late start — let prompt establish composition first
    {
        "name": "08_w08_linear_late_start03_cfg6",
        "ip_weight": 0.8,
        "weight_type": "linear",
        "embeds_scaling": "K+V w/ C penalty",
        "start_at": 0.3,
        "end_at": 1.0,
        "cfg": 6,
        "steps": 30,
        "prompt": "facing right, right side profile, looking right, male knight, plate armor, full body, solo, single character, centered, plain white background",
    },
]

NEGATIVE = "blurry, smooth, realistic, 3d render, photorealistic, watermark, text, signature, noise, extra limbs, deformed, partial body, cropped, helmet, visor, headgear, multiple characters, busy background, frame, border, circular frame, vignette"
SEED = 42


def main():
    print("Uploading concept art...")
    concept_name = upload_image(CONCEPT_IMAGE)
    print(f"  Uploaded as: {concept_name}")

    for exp in EXPERIMENTS:
        name = exp["name"]
        print(f"\n{'='*60}")
        print(f"Running: {name}")
        print(f"  weight={exp['ip_weight']}, type={exp['weight_type']}, embeds={exp['embeds_scaling']}")
        print(f"  start={exp['start_at']}, end={exp['end_at']}, cfg={exp['cfg']}, steps={exp['steps']}")

        workflow = build_ipa_workflow(
            concept_image_name=concept_name,
            prompt=exp["prompt"],
            negative=NEGATIVE,
            ip_weight=exp["ip_weight"],
            weight_type=exp["weight_type"],
            embeds_scaling=exp["embeds_scaling"],
            start_at=exp["start_at"],
            end_at=exp["end_at"],
            cfg=exp["cfg"],
            steps=exp["steps"],
            seed=SEED,
        )

        try:
            prompt_id = submit_workflow(workflow)
            print(f"  Submitted: {prompt_id}")
            entry = poll_completion(prompt_id)

            # Find output image
            for node_id, output in entry["outputs"].items():
                if "images" in output:
                    for img in output["images"]:
                        out_path = os.path.join(OUTPUT_DIR, f"{name}.png")
                        download_image(img, out_path)
                        print(f"  Saved: {out_path}")
        except Exception as e:
            print(f"  ERROR: {e}")

    print(f"\n{'='*60}")
    print(f"All experiments complete! Results in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
