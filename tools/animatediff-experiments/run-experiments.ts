import { ComfyUIClient } from "../packages/ai-providers/src/comfyui.js";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { join } from "path";

const COMFY_URL = "http://localhost:8188";
const REF_IMAGE = "../assets/characters/protagonist/concept.png";
const OUT_DIR = "./animatediff-experiments/results";

interface Experiment {
  name: string;
  prompt: string;
  denoise: number;
  steps: number;
  cfg: number;
  frameCount: number;
  sampler: string;
}

// Experiment grid: vary one parameter at a time from a baseline
const BASELINE = {
  prompt: "pixel art knight walking animation, side view, medieval fantasy, sprite animation, game character",
  denoise: 0.6,
  steps: 20,
  cfg: 7,
  frameCount: 8,
  sampler: "euler",
};

const experiments: Experiment[] = [
  // 1. Denoise sweep
  { name: "denoise_0.3", ...BASELINE, denoise: 0.3 },
  { name: "denoise_0.5", ...BASELINE, denoise: 0.5 },
  { name: "denoise_0.6", ...BASELINE, denoise: 0.6 },
  { name: "denoise_0.7", ...BASELINE, denoise: 0.7 },
  { name: "denoise_0.9", ...BASELINE, denoise: 0.9 },

  // 2. Steps sweep
  { name: "steps_10", ...BASELINE, steps: 10 },
  { name: "steps_15", ...BASELINE, steps: 15 },
  { name: "steps_20", ...BASELINE, steps: 20 },
  { name: "steps_30", ...BASELINE, steps: 30 },

  // 3. CFG sweep
  { name: "cfg_3", ...BASELINE, cfg: 3 },
  { name: "cfg_5", ...BASELINE, cfg: 5 },
  { name: "cfg_7", ...BASELINE, cfg: 7 },
  { name: "cfg_10", ...BASELINE, cfg: 10 },

  // 4. Frame count sweep
  { name: "frames_4", ...BASELINE, frameCount: 4 },
  { name: "frames_8", ...BASELINE, frameCount: 8 },
  { name: "frames_12", ...BASELINE, frameCount: 12 },
  { name: "frames_16", ...BASELINE, frameCount: 16 },

  // 5. Sampler comparison
  { name: "sampler_euler", ...BASELINE, sampler: "euler" },
  { name: "sampler_euler_a", ...BASELINE, sampler: "euler_ancestral" },
  { name: "sampler_dpmpp_2m", ...BASELINE, sampler: "dpmpp_2m" },

  // 6. Different prompts (using baseline params)
  { name: "prompt_idle", ...BASELINE, prompt: "pixel art knight idle animation, breathing motion, standing pose, medieval fantasy, game sprite" },
  { name: "prompt_run", ...BASELINE, prompt: "pixel art knight running animation, fast movement, side view, medieval fantasy, game sprite" },
  { name: "prompt_attack", ...BASELINE, prompt: "pixel art knight attack animation, sword slash, combat pose, medieval fantasy, game sprite" },
];

async function runExperiment(
  client: ComfyUIClient,
  refImage: Uint8Array,
  exp: Experiment,
  outDir: string,
): Promise<{ name: string; elapsed: number; frameFiles: string[]; error?: string }> {
  const expDir = join(outDir, exp.name);
  mkdirSync(expDir, { recursive: true });

  // Write params for reference
  writeFileSync(join(expDir, "params.json"), JSON.stringify(exp, null, 2));

  const start = Date.now();
  console.log(`\n=== ${exp.name} ===`);
  console.log(`  denoise=${exp.denoise} steps=${exp.steps} cfg=${exp.cfg} frames=${exp.frameCount} sampler=${exp.sampler}`);
  console.log(`  prompt: "${exp.prompt.slice(0, 60)}..."`);

  try {
    const seed = 42; // Fixed seed for reproducibility across experiments

    const result = await client.generateAnimateDiff(
      exp.prompt,
      refImage,
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

    // Save first frame (returned by API)
    writeFileSync(join(expDir, "frame_00.png"), result);

    // Fetch remaining frames from ComfyUI output
    const frameFiles: string[] = ["frame_00.png"];
    for (let i = 1; i < exp.frameCount; i++) {
      try {
        const paddedIdx = String(i + 1).padStart(5, "0");
        const filename = `vulkan_game_anim_frame__${paddedIdx}_.png`;
        const viewUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(filename)}&type=output`;
        const res = await fetch(viewUrl);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const frameFile = `frame_${String(i).padStart(2, "0")}.png`;
          writeFileSync(join(expDir, frameFile), new Uint8Array(buf));
          frameFiles.push(frameFile);
        }
      } catch {
        // skip missing frames
      }
    }

    // Copy the GIF from ComfyUI output (latest one)
    const comfyOutput = "../tools/ComfyUI/output";
    // Find latest gif
    try {
      const { readdirSync, statSync } = await import("fs");
      const gifFiles = readdirSync(join(process.cwd(), comfyOutput))
        .filter((f: string) => f.startsWith("vulkan_game_anim_") && f.endsWith(".gif"))
        .sort((a: string, b: string) => {
          const sa = statSync(join(process.cwd(), comfyOutput, a)).mtimeMs;
          const sb = statSync(join(process.cwd(), comfyOutput, b)).mtimeMs;
          return sb - sa;
        });
      if (gifFiles.length > 0) {
        copyFileSync(join(process.cwd(), comfyOutput, gifFiles[0]), join(expDir, "animation.gif"));
        frameFiles.push("animation.gif");
      }
    } catch { /* ignore */ }

    const elapsed = (Date.now() - start) / 1000;
    console.log(`  Done in ${elapsed.toFixed(1)}s — ${frameFiles.length} files saved to ${exp.name}/`);

    return { name: exp.name, elapsed, frameFiles };
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    const error = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR after ${elapsed.toFixed(1)}s: ${error}`);
    writeFileSync(join(expDir, "error.txt"), error);
    return { name: exp.name, elapsed, frameFiles: [], error };
  }
}

async function main() {
  const client = new ComfyUIClient(COMFY_URL, 1000, 600_000);

  const avail = await client.checkAvailability();
  if (!avail.available) {
    console.error("ComfyUI not available:", avail.error);
    process.exit(1);
  }

  const models = await client.listMotionModels();
  console.log("Motion models:", models);
  if (models.length === 0) {
    console.error("No motion models found!");
    process.exit(1);
  }

  const refImage = new Uint8Array(readFileSync(REF_IMAGE));
  console.log(`Reference image: ${refImage.length} bytes`);

  const outDir = join(process.cwd(), OUT_DIR);
  mkdirSync(outDir, { recursive: true });

  const results: Array<{ name: string; elapsed: number; frameFiles: string[]; error?: string }> = [];

  for (const exp of experiments) {
    // Skip if already done
    if (existsSync(join(outDir, exp.name, "frame_00.png"))) {
      console.log(`\n=== ${exp.name} === SKIPPED (already exists)`);
      results.push({ name: exp.name, elapsed: 0, frameFiles: ["(cached)"] });
      continue;
    }
    const result = await runExperiment(client, refImage, exp, outDir);
    results.push(result);
  }

  // Write summary
  console.log("\n\n========== SUMMARY ==========");
  console.log(`${"Name".padEnd(25)} ${"Time".padStart(8)} ${"Frames".padStart(8)} ${"Status".padStart(10)}`);
  console.log("-".repeat(55));
  for (const r of results) {
    const status = r.error ? "ERROR" : "OK";
    console.log(
      `${r.name.padEnd(25)} ${(r.elapsed.toFixed(1) + "s").padStart(8)} ${String(r.frameFiles.length).padStart(8)} ${status.padStart(10)}`,
    );
  }

  writeFileSync(
    join(outDir, "summary.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nResults saved to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
