import { ComfyUIClient } from "../packages/ai-providers/src/comfyui.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";

const COMFY_URL = "http://localhost:8188";
const COMFY_DIR = "/Users/eccyan/dev/vulkan-game/tools/ComfyUI";
const PYTHON = `${COMFY_DIR}/venv/bin/python`;
const PAD_SCRIPT = "./animatediff-experiments/pad-image.py";
const OUT_DIR = "./animatediff-experiments/results-chibi";
const COMFY_OUTPUT = `${COMFY_DIR}/output`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function killComfy(): Promise<void> {
  try { execSync("lsof -ti :8188 | xargs kill -9 2>/dev/null", { stdio: "ignore" }); } catch {}
  try { execSync("pkill -9 -f 'main.py --listen' 2>/dev/null", { stdio: "ignore" }); } catch {}
  await sleep(3000);
}

async function startComfy(): Promise<void> {
  await killComfy();
  console.log("  Starting ComfyUI...");
  const child = spawn(PYTHON, ["main.py", "--listen", "--enable-cors-header", "*", "--force-fp32"], {
    cwd: COMFY_DIR,
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    try {
      const res = await fetch(`${COMFY_URL}/system_stats`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log("  ComfyUI ready");
        return;
      }
    } catch {}
  }
  throw new Error("ComfyUI failed to start");
}

interface Experiment {
  name: string;
  prompt: string;
  denoise: number;
  margin: number;
  refImage: "chibi" | "concept";
}

const BASE_PROMPT = "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character";

const experiments: Experiment[] = [
  { name: "chibi_no_margin",       margin: 0,   denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "concept_no_margin",     margin: 0,   denoise: 0.6, refImage: "concept", prompt: BASE_PROMPT },
  { name: "chibi_margin_32",       margin: 32,  denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_margin_64",       margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_margin_96",       margin: 96,  denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_margin_128",      margin: 128, denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_m64_denoise_0.4", margin: 64,  denoise: 0.4, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_m64_denoise_0.6", margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_m64_denoise_0.8", margin: 64,  denoise: 0.8, refImage: "chibi",   prompt: BASE_PROMPT },
  { name: "chibi_m64_idle",        margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: "pixel art chibi knight idle breathing animation, standing pose, medieval fantasy, game sprite" },
  { name: "chibi_m64_run",         margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: "pixel art chibi knight running animation, fast movement, side view, medieval fantasy, game sprite" },
  { name: "chibi_m64_attack",      margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: "pixel art chibi knight attack animation, weapon slash, combat pose, medieval fantasy, game sprite" },
  { name: "chibi_m64_pixelart",    margin: 64,  denoise: 0.6, refImage: "chibi",   prompt: "Pixel Art, PIXARFK, chibi knight walking animation, side view, 2D sprite sheet style, retro game character" },
  { name: "concept_margin_64",     margin: 64,  denoise: 0.6, refImage: "concept", prompt: BASE_PROMPT },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const results: Array<{ name: string; elapsed: number; ok: boolean; error?: string }> = [];

  for (const exp of experiments) {
    const expDir = join(OUT_DIR, exp.name);
    if (existsSync(join(expDir, "frame_00.png"))) {
      console.log(`\n=== ${exp.name} === SKIPPED`);
      results.push({ name: exp.name, elapsed: 0, ok: true });
      continue;
    }

    console.log(`\n=== ${exp.name} ===`);
    console.log(`  ref=${exp.refImage} margin=${exp.margin} denoise=${exp.denoise}`);

    const start = Date.now();
    try {
      // Restart ComfyUI fresh for each experiment
      await startComfy();

      mkdirSync(expDir, { recursive: true });
      writeFileSync(join(expDir, "params.json"), JSON.stringify(exp, null, 2));

      // Pad image
      const srcImage = exp.refImage === "chibi"
        ? "../assets/characters/protagonist/chibi.png"
        : "../assets/characters/protagonist/concept.png";
      const paddedPath = join(expDir, "input_padded.png");

      if (exp.margin > 0) {
        execSync(`${PYTHON} ${PAD_SCRIPT} "${srcImage}" "${paddedPath}" ${exp.margin} 128 128 128`);
      } else {
        execSync(`cp "${srcImage}" "${paddedPath}"`);
      }

      const refBytes = new Uint8Array(readFileSync(paddedPath));
      console.log(`  Input: ${refBytes.length} bytes`);

      const client = new ComfyUIClient(COMFY_URL, 1000, 600_000);
      const result = await client.generateAnimateDiff(
        exp.prompt,
        refBytes,
        {
          motionModel: "mm_sd_v15_v2.ckpt",
          frameCount: 8,
          frameRate: 8,
          steps: 20,
          width: 512,
          height: 512,
          denoise: exp.denoise,
          cfgScale: 7,
          samplerName: "euler",
          seed: 42,
          outputFormat: "image/gif",
          loopCount: 0,
          negativePrompt: "bad quality, blurry, deformed, static, still image, realistic, 3d render",
        },
      );

      // Save first frame
      writeFileSync(join(expDir, "frame_00.png"), result);

      // Fetch remaining frames
      for (let i = 1; i < 8; i++) {
        try {
          const idx = String(i + 1).padStart(5, "0");
          const res = await fetch(`${COMFY_URL}/view?filename=vulkan_game_anim_frame__${idx}_.png&type=output`);
          if (res.ok) {
            writeFileSync(join(expDir, `frame_${String(i).padStart(2, "0")}.png`), new Uint8Array(await res.arrayBuffer()));
          }
        } catch {}
      }

      // Copy latest GIF
      try {
        const gifs = readdirSync(COMFY_OUTPUT)
          .filter((f) => f.startsWith("vulkan_game_anim_") && f.endsWith(".gif"))
          .sort((a, b) => statSync(join(COMFY_OUTPUT, b)).mtimeMs - statSync(join(COMFY_OUTPUT, a)).mtimeMs);
        if (gifs.length > 0) copyFileSync(join(COMFY_OUTPUT, gifs[0]), join(expDir, "animation.gif"));
      } catch {}

      const elapsed = (Date.now() - start) / 1000;
      console.log(`  Done in ${elapsed.toFixed(1)}s`);
      results.push({ name: exp.name, elapsed, ok: true });
    } catch (err) {
      const elapsed = (Date.now() - start) / 1000;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${error}`);
      results.push({ name: exp.name, elapsed, ok: false, error });
    }
  }

  // Summary
  console.log("\n\n========== SUMMARY ==========");
  for (const r of results) {
    console.log(`${r.name.padEnd(30)} ${r.ok ? "OK" : "ERROR"} ${r.elapsed.toFixed(0)}s ${r.error ?? ""}`);
  }
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(results, null, 2));

  // Kill ComfyUI at the end
  await killComfy();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
