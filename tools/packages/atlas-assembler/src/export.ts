/**
 * Standalone export — generates engine-agnostic spritesheet or individual-frame
 * packages with metadata.json for external game engines.
 */

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CharacterManifest } from "@gseurat/asset-types";
import type {
  SpritesheetExportMetadata,
  IndividualExportMetadata,
  ExportFrameCoord,
  ExportFrameFile,
} from "@gseurat/asset-types";

export interface ExportOptions {
  charactersDir: string;
  outputDir: string;
  format: "spritesheet" | "individual";
}

export interface ExportCharacterResult {
  characterId: string;
  outputDir: string;
  format: string;
  frameCount: number;
  errors: string[];
}

/**
 * Export multiple characters to standalone packages.
 */
export async function exportCharacters(
  characterIds: string[],
  options: ExportOptions,
): Promise<ExportCharacterResult[]> {
  const results: ExportCharacterResult[] = [];

  for (const id of characterIds) {
    const result = await exportSingleCharacter(id, options);
    results.push(result);
  }

  return results;
}

async function exportSingleCharacter(
  characterId: string,
  options: ExportOptions,
): Promise<ExportCharacterResult> {
  const { charactersDir, outputDir, format } = options;
  const charDir = path.join(charactersDir, characterId);
  const charOutputDir = path.join(outputDir, characterId);
  const errors: string[] = [];

  // Load manifest
  const manifestPath = path.join(charDir, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as CharacterManifest;
  const { frame_width, frame_height, columns } = manifest.spritesheet;

  await fs.mkdir(charOutputDir, { recursive: true });

  let frameCount = 0;

  if (format === "spritesheet") {
    frameCount = await exportAsSpritesheet(
      manifest,
      charDir,
      charOutputDir,
      errors,
    );
  } else {
    frameCount = await exportAsIndividual(
      manifest,
      charDir,
      charOutputDir,
      errors,
    );
  }

  return {
    characterId,
    outputDir: charOutputDir,
    format,
    frameCount,
    errors,
  };
}

async function exportAsSpritesheet(
  manifest: CharacterManifest,
  charDir: string,
  outputDir: string,
  errors: string[],
): Promise<number> {
  const { frame_width, frame_height, columns } = manifest.spritesheet;
  const totalRows = manifest.animations.length;
  const framesPerRow = Math.max(
    ...manifest.animations.map((a) => a.frames.length),
    columns,
  );

  const sheetWidth = frame_width * framesPerRow;
  const sheetHeight = frame_height * totalRows;

  const composites: sharp.OverlayOptions[] = [];
  let frameCount = 0;

  const animations: SpritesheetExportMetadata["animations"] = [];

  for (const anim of manifest.animations) {
    const frames: ExportFrameCoord[] = [];

    for (const frame of anim.frames) {
      const col = frame.index;
      const row = anim.row;
      const x = col * frame_width;
      const y = row * frame_height;

      if (frame.status === "generated" && frame.file) {
        const framePath = path.join(charDir, frame.file);
        try {
          const resized = await sharp(framePath)
            .resize(frame_width, frame_height, { fit: "fill" })
            .ensureAlpha()
            .raw()
            .toBuffer();
          composites.push({
            input: resized,
            left: x,
            top: y,
            raw: { width: frame_width, height: frame_height, channels: 4 },
          });
          frameCount++;
        } catch {
          errors.push(`${anim.name}[${frame.index}]: file not found: ${frame.file}`);
        }
      }

      frames.push({
        x,
        y,
        w: frame_width,
        h: frame_height,
        duration: frame.duration,
      });
    }

    animations.push({ name: anim.name, loop: anim.loop, frames });
  }

  // Composite spritesheet
  const spritesheetPath = path.join(outputDir, "spritesheet.png");
  const base = sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  await base.composite(composites).png().toFile(spritesheetPath);

  // Write metadata
  const metadata: SpritesheetExportMetadata = {
    version: 1,
    generator: "seurat",
    character_id: manifest.character_id,
    display_name: manifest.display_name,
    spritesheet: "spritesheet.png",
    frame_width,
    frame_height,
    sheet_width: sheetWidth,
    sheet_height: sheetHeight,
    columns: framesPerRow,
    animations,
  };

  await fs.writeFile(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  return frameCount;
}

async function exportAsIndividual(
  manifest: CharacterManifest,
  charDir: string,
  outputDir: string,
  errors: string[],
): Promise<number> {
  const { frame_width, frame_height } = manifest.spritesheet;
  let frameCount = 0;

  const animations: IndividualExportMetadata["animations"] = [];

  for (const anim of manifest.animations) {
    const animDir = path.join(outputDir, anim.name);
    await fs.mkdir(animDir, { recursive: true });
    const frames: ExportFrameFile[] = [];

    for (const frame of anim.frames) {
      const outFile = `${anim.name}/frame_${frame.index}.png`;
      const outPath = path.join(outputDir, outFile);

      if (frame.status === "generated" && frame.file) {
        const framePath = path.join(charDir, frame.file);
        try {
          await sharp(framePath)
            .resize(frame_width, frame_height, { fit: "fill" })
            .png()
            .toFile(outPath);
          frameCount++;
        } catch {
          errors.push(`${anim.name}[${frame.index}]: file not found: ${frame.file}`);
        }
      }

      frames.push({ file: outFile, duration: frame.duration });
    }

    animations.push({ name: anim.name, loop: anim.loop, frames });
  }

  // Write metadata
  const metadata: IndividualExportMetadata = {
    version: 1,
    generator: "seurat",
    character_id: manifest.character_id,
    display_name: manifest.display_name,
    frame_width,
    frame_height,
    animations,
  };

  await fs.writeFile(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  return frameCount;
}
