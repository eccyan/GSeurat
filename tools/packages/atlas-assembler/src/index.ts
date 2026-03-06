/**
 * Atlas Assembler — composites individual frame PNGs into engine-ready sprite sheets
 * and generates animations.json for the C++ engine to consume.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type {
  CharacterManifest,
  EngineAnimations,
  EngineClip,
  EngineTileset,
} from "@vulkan-game-tools/asset-types";
import { loadManifest, saveManifest } from "./manifest-ops.js";
import { runAllChecks } from "./quality-checks.js";

// Resolve from the engine root
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const ENGINE_ROOT = path.resolve(__dirname, "../../../..");
const CHARACTERS_DIR = path.join(ENGINE_ROOT, "assets/characters");

// Magenta placeholder for missing/rejected frames
const PLACEHOLDER_RGBA = [255, 0, 255, 255] as const;

function characterDir(characterId: string): string {
  return path.join(CHARACTERS_DIR, characterId);
}

export interface AssembleOptions {
  validate?: boolean; // dry-run: check without writing
  placeholderColor?: [number, number, number, number];
}

export interface AssembleResult {
  spritesheet: string; // output path
  animationsJson: string; // output path
  totalFrames: number;
  approvedFrames: number;
  placeholderFrames: number;
  rejectedFrames: number;
  errors: string[];
  warnings: string[];
}

/**
 * Assemble a character's sprite sheet from individual frame PNGs.
 */
export async function assembleCharacterAtlas(
  characterId: string,
  options: AssembleOptions = {},
): Promise<AssembleResult> {
  const dir = characterDir(characterId);
  const manifest = await loadManifest(characterId);
  const { frame_width, frame_height, columns } = manifest.spritesheet;
  const totalRows = manifest.animations.length;
  const framesPerRow = Math.max(...manifest.animations.map((a) => a.frames.length), columns);

  const sheetWidth = frame_width * framesPerRow;
  const sheetHeight = frame_height * totalRows;

  const placeholder = options.placeholderColor ?? [...PLACEHOLDER_RGBA];
  const errors: string[] = [];
  const warnings: string[] = [];
  let approvedFrames = 0;
  let placeholderFrames = 0;
  let rejectedFrames = 0;
  let totalFrames = 0;

  // Build composite operations
  const composites: sharp.OverlayOptions[] = [];

  for (const anim of manifest.animations) {
    for (const frame of anim.frames) {
      totalFrames++;
      const col = frame.index;
      const row = anim.row;
      const x = col * frame_width;
      const y = row * frame_height;

      if (frame.status === "rejected") {
        rejectedFrames++;
        // Use placeholder
        const buf = createSolidFrame(frame_width, frame_height, placeholder);
        composites.push({ input: buf, left: x, top: y, raw: { width: frame_width, height: frame_height, channels: 4 } });
        warnings.push(`${anim.name}[${frame.index}]: rejected — using placeholder`);
        continue;
      }

      if (frame.status === "approved" || frame.status === "generated") {
        const framePath = path.join(dir, frame.file);
        try {
          await fs.access(framePath);

          if (!options.validate) {
            // Run quality checks on the frame
            const img = sharp(framePath);
            const meta = await img.metadata();
            const rawPixels = await img.ensureAlpha().raw().toBuffer();
            const qr = runAllChecks(
              rawPixels,
              meta.width ?? 0,
              meta.height ?? 0,
              frame_width,
              frame_height,
            );

            if (!qr.passed) {
              for (const c of qr.checks) {
                if (!c.passed) errors.push(`${anim.name}[${frame.index}]: ${c.message}`);
              }
              // Still composite but report errors
            }

            // Resize if needed, then composite
            const resized = await sharp(framePath)
              .resize(frame_width, frame_height, { fit: "fill" })
              .ensureAlpha()
              .raw()
              .toBuffer();
            composites.push({ input: resized, left: x, top: y, raw: { width: frame_width, height: frame_height, channels: 4 } });
          }

          if (frame.status === "approved") approvedFrames++;
        } catch {
          errors.push(`${anim.name}[${frame.index}]: file not found: ${frame.file}`);
          const buf = createSolidFrame(frame_width, frame_height, placeholder);
          composites.push({ input: buf, left: x, top: y, raw: { width: frame_width, height: frame_height, channels: 4 } });
          placeholderFrames++;
        }
      } else {
        // pending / generating — use placeholder
        placeholderFrames++;
        const buf = createSolidFrame(frame_width, frame_height, placeholder);
        composites.push({ input: buf, left: x, top: y, raw: { width: frame_width, height: frame_height, channels: 4 } });
      }
    }
  }

  const spritesheetPath = path.join(dir, "spritesheet.png");
  const animationsPath = path.join(dir, "animations.json");

  if (!options.validate) {
    // Create the sprite sheet
    const base = sharp({
      create: {
        width: sheetWidth,
        height: sheetHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    await base.composite(composites).png().toFile(spritesheetPath);

    // Generate engine-consumable animations.json
    const engineAnims = generateEngineAnimations(manifest, sheetWidth, sheetHeight);
    await fs.writeFile(animationsPath, JSON.stringify(engineAnims, null, 2));

    // Update atlas info in manifest
    manifest.atlas = {
      file: "spritesheet.png",
      width: sheetWidth,
      height: sheetHeight,
    };
    await saveManifest(manifest);
  }

  return {
    spritesheet: spritesheetPath,
    animationsJson: animationsPath,
    totalFrames,
    approvedFrames,
    placeholderFrames,
    rejectedFrames,
    errors,
    warnings,
  };
}

function createSolidFrame(
  width: number,
  height: number,
  color: readonly number[] | number[],
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = color[0]!;
    buf[i * 4 + 1] = color[1]!;
    buf[i * 4 + 2] = color[2]!;
    buf[i * 4 + 3] = color[3]!;
  }
  return buf;
}

function generateEngineAnimations(
  manifest: CharacterManifest,
  sheetWidth: number,
  sheetHeight: number,
): EngineAnimations {
  const { frame_width, frame_height, columns } = manifest.spritesheet;

  const tileset: EngineTileset = {
    tile_width: frame_width,
    tile_height: frame_height,
    columns,
    sheet_width: sheetWidth,
    sheet_height: sheetHeight,
  };

  const clips: EngineClip[] = manifest.animations.map((anim) => ({
    name: anim.name,
    loop: anim.loop,
    frames: anim.frames.map((f) => ({
      tile_id: f.tile_id,
      duration: f.duration,
    })),
  }));

  return {
    character_id: manifest.character_id,
    tileset,
    clips,
  };
}

export { loadManifest, saveManifest } from "./manifest-ops.js";
export * from "./manifest-ops.js";
export * from "./quality-checks.js";
