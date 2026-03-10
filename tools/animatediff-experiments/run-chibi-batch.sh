#!/bin/bash
# Run chibi experiments one at a time, restarting ComfyUI between each to avoid MPS hangs.
set -e

COMFY_DIR="/Users/eccyan/dev/vulkan-game/tools/ComfyUI"
TOOLS_DIR="/Users/eccyan/dev/vulkan-game/tools"
PYTHON="$COMFY_DIR/venv/bin/python"

restart_comfy() {
  echo "--- Restarting ComfyUI ---"
  lsof -ti :8188 | xargs kill -9 2>/dev/null || true
  sleep 3
  cd "$COMFY_DIR"
  nohup "$PYTHON" main.py --listen --enable-cors-header '*' --force-fp32 > /tmp/comfyui.log 2>&1 &
  # Wait for it to be ready
  for i in $(seq 1 60); do
    sleep 2
    if curl -s http://localhost:8188/system_stats > /dev/null 2>&1; then
      echo "ComfyUI ready"
      return 0
    fi
  done
  echo "ComfyUI failed to start!"
  return 1
}

run_one() {
  local name="$1"
  local ref="$2"
  local margin="$3"
  local denoise="$4"
  local prompt="$5"

  local outdir="$TOOLS_DIR/animatediff-experiments/results-chibi/$name"
  if [ -f "$outdir/frame_00.png" ]; then
    echo "=== $name === SKIPPED"
    return 0
  fi

  restart_comfy
  cd "$TOOLS_DIR"

  mkdir -p "$outdir"

  # Pad image
  local src_image
  if [ "$ref" = "chibi" ]; then
    src_image="../assets/characters/protagonist/chibi.png"
  else
    src_image="../assets/characters/protagonist/concept.png"
  fi

  local padded="$outdir/input_padded.png"
  if [ "$margin" -gt 0 ]; then
    "$PYTHON" animatediff-experiments/pad-image.py "$src_image" "$padded" "$margin" 128 128 128
  else
    cp "$src_image" "$padded"
  fi

  echo "=== $name ==="
  echo '{"name":"'"$name"'","ref":"'"$ref"'","margin":'"$margin"',"denoise":'"$denoise"'}' > "$outdir/params.json"

  # Run generation via inline TypeScript
  npx tsx -e '
    const { ComfyUIClient } = require("./packages/ai-providers/src/comfyui.js");
    const { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } = require("fs");
    const { join } = require("path");

    async function main() {
      const client = new ComfyUIClient("http://localhost:8188", 1000, 600000);
      const ref = new Uint8Array(readFileSync("'"$padded"'"));
      const outdir = "'"$outdir"'";

      const result = await client.generateAnimateDiff(
        "'"$prompt"'",
        ref,
        {
          motionModel: "mm_sd_v15_v2.ckpt",
          frameCount: 8, frameRate: 8, steps: 20,
          width: 512, height: 512, denoise: '"$denoise"',
          cfgScale: 7, samplerName: "euler", seed: 42,
          outputFormat: "image/gif", loopCount: 0,
          negativePrompt: "bad quality, blurry, deformed, static, still image, realistic, 3d render",
        },
      );
      writeFileSync(join(outdir, "frame_00.png"), result);

      for (let i = 1; i < 8; i++) {
        try {
          const idx = String(i + 1).padStart(5, "0");
          const res = await fetch("http://localhost:8188/view?filename=vulkan_game_anim_frame__" + idx + "_.png&type=output");
          if (res.ok) writeFileSync(join(outdir, "frame_" + String(i).padStart(2, "0") + ".png"), new Uint8Array(await res.arrayBuffer()));
        } catch {}
      }

      // Copy latest GIF
      try {
        const d = "../tools/ComfyUI/output";
        const gifs = readdirSync(d).filter(f => f.startsWith("vulkan_game_anim_") && f.endsWith(".gif"))
          .sort((a,b) => statSync(join(d,b)).mtimeMs - statSync(join(d,a)).mtimeMs);
        if (gifs.length > 0) copyFileSync(join(d, gifs[0]), join(outdir, "animation.gif"));
      } catch {}

      console.log("OK: " + result.length + " bytes");
    }
    main().catch(e => { console.error(e.message); process.exit(1); });
  ' 2>&1

  echo "=== $name done ==="
}

# Run all experiments
run_one "chibi_no_margin"      chibi   0   0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "concept_no_margin"    concept 0   0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_margin_32"      chibi   32  0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_margin_64"      chibi   64  0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_margin_96"      chibi   96  0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_margin_128"     chibi   128 0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_m64_denoise_0.4" chibi  64  0.4 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_m64_denoise_0.6" chibi  64  0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_m64_denoise_0.8" chibi  64  0.8 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"
run_one "chibi_m64_idle"       chibi   64  0.6 "pixel art chibi knight idle breathing animation, standing pose, medieval fantasy, game sprite"
run_one "chibi_m64_run"        chibi   64  0.6 "pixel art chibi knight running animation, fast movement, side view, medieval fantasy, game sprite"
run_one "chibi_m64_attack"     chibi   64  0.6 "pixel art chibi knight attack animation, weapon slash, combat pose, medieval fantasy, game sprite"
run_one "chibi_m64_pixelart"   chibi   64  0.6 "Pixel Art, PIXARFK, chibi knight walking animation, side view, 2D sprite sheet style, retro game character"
run_one "concept_margin_64"    concept 64  0.6 "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character"

echo "ALL DONE"
