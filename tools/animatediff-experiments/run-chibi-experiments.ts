import { ComfyUIClient } from "../packages/ai-providers/src/comfyui.js";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const COMFY_URL = "http://localhost:8188";
const CHIBI_IMAGE = "../assets/characters/protagonist/chibi.png";
const CONCEPT_IMAGE = "../assets/characters/protagonist/concept.png";
const OUT_DIR = "./animatediff-experiments/results-chibi";
const COMFY_OUTPUT = "../tools/ComfyUI/output";
const PYTHON = "../tools/ComfyUI/venv/bin/python";
const PAD_SCRIPT = "./animatediff-experiments/pad-image.py";

function padImage(inputPath: string, outputPath: string, margin: number): void {
  if (margin <= 0) {
    // Just copy
    execSync(`cp "${inputPath}" "${outputPath}"`);
    return;
  }
  const result = execSync(`${PYTHON} ${PAD_SCRIPT} "${inputPath}" "${outputPath}" ${margin} 128 128 128`);
  console.log(`  Padded to ${result.toString().trim()}`);
}

interface Experiment {
  name: string;
  prompt: string;
  denoise: number;
  steps: number;
  cfg: number;
  frameCount: number;
  sampler: string;
  margin: number;
  refImage: "chibi" | "concept";
}

const BASELINE = {
  prompt: "pixel art chibi knight walking animation, side view, medieval fantasy, sprite animation, game character",
  denoise: 0.6,
  steps: 20,
  cfg: 7,
  frameCount: 8,
  sampler: "euler",
};

const experiments: Experiment[] = [
  // 1. Chibi vs Concept (no margin)
  { name: "chibi_no_margin",   ...BASELINE, margin: 0,  refImage: "chibi" },
  { name: "concept_no_margin", ...BASELINE, margin: 0,  refImage: "concept" },

  // 2. Margin sweep with chibi
  { name: "chibi_margin_32",   ...BASELINE, margin: 32,  refImage: "chibi" },
  { name: "chibi_margin_64",   ...BASELINE, margin: 64,  refImage: "chibi" },
  { name: "chibi_margin_96",   ...BASELINE, margin: 96,  refImage: "chibi" },
  { name: "chibi_margin_128",  ...BASELINE, margin: 128, refImage: "chibi" },

  // 3. Best margin + denoise sweep
  { name: "chibi_m64_denoise_0.4", ...BASELINE, margin: 64, denoise: 0.4, refImage: "chibi" },
  { name: "chibi_m64_denoise_0.6", ...BASELINE, margin: 64, denoise: 0.6, refImage: "chibi" },
  { name: "chibi_m64_denoise_0.8", ...BASELINE, margin: 64, denoise: 0.8, refImage: "chibi" },

  // 4. Different prompts with margin
  { name: "chibi_m64_idle",    ...BASELINE, margin: 64, refImage: "chibi", prompt: "pixel art chibi knight idle breathing animation, standing pose, medieval fantasy, game sprite" },
  { name: "chibi_m64_run",     ...BASELINE, margin: 64, refImage: "chibi", prompt: "pixel art chibi knight running animation, fast movement, side view, medieval fantasy, game sprite" },
  { name: "chibi_m64_attack",  ...BASELINE, margin: 64, refImage: "chibi", prompt: "pixel art chibi knight attack animation, weapon slash, combat pose, medieval fantasy, game sprite" },

  // 5. Pixel art LoRA-trigger prompt
  { name: "chibi_m64_pixelart", ...BASELINE, margin: 64, refImage: "chibi", prompt: "Pixel Art, PIXARFK, chibi knight walking animation, side view, 2D sprite sheet style, retro game character" },

  // 6. Concept + margin for comparison
  { name: "concept_margin_64", ...BASELINE, margin: 64, refImage: "concept" },
];

function fetchLatestGif(expDir: string): void {
  try {
    const comfyOutputDir = join(process.cwd(), COMFY_OUTPUT);
    const gifFiles = readdirSync(comfyOutputDir)
      .filter((f) => f.startsWith("vulkan_game_anim_") && f.endsWith(".gif"))
      .sort((a, b) => statSync(join(comfyOutputDir, b)).mtimeMs - statSync(join(comfyOutputDir, a)).mtimeMs);
    if (gifFiles.length > 0) {
      copyFileSync(join(comfyOutputDir, gifFiles[0]), join(expDir, "animation.gif"));
    }
  } catch { /* ignore */ }
}

async function runExperiment(
  client: ComfyUIClient,
  exp: Experiment,
  outDir: string,
): Promise<{ name: string; elapsed: number; files: number; error?: string }> {
  const expDir = join(outDir, exp.name);
  mkdirSync(expDir, { recursive: true });
  writeFileSync(join(expDir, "params.json"), JSON.stringify(exp, null, 2));

  const start = Date.now();
  console.log(`\n=== ${exp.name} ===`);
  console.log(`  ref=${exp.refImage} margin=${exp.margin} denoise=${exp.denoise} steps=${exp.steps} cfg=${exp.cfg}`);

  try {
    // Pad the image using Pillow
    const srcImage = exp.refImage === "chibi" ? CHIBI_IMAGE : CONCEPT_IMAGE;
    const paddedPath = join(expDir, "input_padded.png");
    padImage(srcImage, paddedPath, exp.margin);
    const refWithMargin = new Uint8Array(readFileSync(paddedPath));

    const seed = 42;
    const result = await client.generateAnimateDiff(
      exp.prompt,
      refWithMargin,
      {
        motionModel: "mm_sd_v15_v2.ckpt",
        frameCount: exp.frameCount,
        frameRate: 8,
        steps: exp.steps,
        width: 512,
        height: 512,
        denoise: exp.denoise,
        cfgScale: exp.cfg,
        samplerName: exp.sampler,
        seed,
        outputFormat: "image/gif",
        loopCount: 0,
        negativePrompt: "bad quality, blurry, deformed, static, still image, realistic, 3d render",
      },
    );

    writeFileSync(join(expDir, "frame_00.png"), result);
    let fileCount = 1;

    // Fetch remaining frames
    for (let i = 1; i < exp.frameCount; i++) {
      try {
        const paddedIdx = String(i + 1).padStart(5, "0");
        const filename = `vulkan_game_anim_frame__${paddedIdx}_.png`;
        const res = await fetch(`${COMFY_URL}/view?filename=${encodeURIComponent(filename)}&type=output`);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          writeFileSync(join(expDir, `frame_${String(i).padStart(2, "0")}.png`), new Uint8Array(buf));
          fileCount++;
        }
      } catch { /* skip */ }
    }

    fetchLatestGif(expDir);
    fileCount++;

    const elapsed = (Date.now() - start) / 1000;
    console.log(`  Done in ${elapsed.toFixed(1)}s — ${fileCount} files`);
    return { name: exp.name, elapsed, files: fileCount };
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR: ${error}`);
    writeFileSync(join(expDir, "error.txt"), error);
    return { name: exp.name, elapsed, files: 0, error };
  }
}

async function main() {
  const client = new ComfyUIClient(COMFY_URL, 1000, 600_000);

  const avail = await client.checkAvailability();
  if (!avail.available) {
    console.error("ComfyUI not available:", avail.error);
    process.exit(1);
  }
  console.log("ComfyUI available");

  const outDir = join(process.cwd(), OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  const results: Array<{ name: string; elapsed: number; files: number; error?: string }> = [];

  for (const exp of experiments) {
    if (existsSync(join(outDir, exp.name, "frame_00.png"))) {
      console.log(`\n=== ${exp.name} === SKIPPED (exists)`);
      results.push({ name: exp.name, elapsed: 0, files: -1 });
      continue;
    }
    results.push(await runExperiment(client, exp, outDir));
  }

  console.log("\n\n========== CHIBI EXPERIMENT SUMMARY ==========");
  console.log(`${"Name".padEnd(30)} ${"Time".padStart(8)} ${"Files".padStart(8)} ${"Status".padStart(10)}`);
  console.log("-".repeat(60));
  for (const r of results) {
    const status = r.error ? "ERROR" : r.files < 0 ? "CACHED" : "OK";
    console.log(
      `${r.name.padEnd(30)} ${(r.elapsed.toFixed(1) + "s").padStart(8)} ${String(r.files).padStart(8)} ${status.padStart(10)}`,
    );
  }

  writeFileSync(join(outDir, "summary.json"), JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
