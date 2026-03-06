import type { PainterState, RGBA, PixelData, EditTarget, DrawingTool, ActiveLayer, HeightmapData } from '../store/usePainterStore.js';
import { pixelDims, makeBlankPixels } from '../store/usePainterStore.js';
import { heightmapToNormalMap } from './normal-map.js';
import type { AssetManifest } from '@vulkan-game-tools/asset-types';
import { ComfyUIClient } from '@vulkan-game-tools/ai-providers';
import {
  buildFullPrompt,
  buildNegativePrompt,
  buildRowPrompt,
  downscaleToPixelData,
  sliceStripToFrames,
  pixelsToHeightmap,
  SAMPLER_NAMES,
  DEFAULT_NEGATIVE_PROMPT,
} from './ai-generate-helpers.js';

// ---------------------------------------------------------------------------
// Base64 RGBA helpers
// ---------------------------------------------------------------------------

function pixelsToBase64(pixels: PixelData): string {
  let binary = '';
  for (let i = 0; i < pixels.length; i++) {
    binary += String.fromCharCode(pixels[i]);
  }
  return btoa(binary);
}

function base64ToPixels(b64: string): PixelData {
  const binary = atob(b64);
  const arr = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr as PixelData;
}

function heightmapToBase64(hm: HeightmapData): string {
  let binary = '';
  for (let i = 0; i < hm.length; i++) {
    binary += String.fromCharCode(hm[i]);
  }
  return btoa(binary);
}

function base64ToHeightmap(b64: string): HeightmapData {
  const binary = atob(b64);
  const arr = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr as HeightmapData;
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export type CommandResult = { response: unknown } | { error: string };

export function handleCommand(
  cmd: string,
  params: Record<string, unknown>,
  store: PainterState,
): CommandResult | Promise<CommandResult> {
  switch (cmd) {
    case 'get_state': {
      const { w, h } = pixelDims(store);
      return {
        response: {
          manifest: store.manifest,
          editTarget: store.editTarget,
          selectedTileCol: store.selectedTileCol,
          selectedTileRow: store.selectedTileRow,
          selectedFrameCol: store.selectedFrameCol,
          selectedFrameRow: store.selectedFrameRow,
          activeTool: store.activeTool,
          mirrorMode: store.mirrorMode,
          zoom: store.zoom,
          showGrid: store.showGrid,
          fgColor: store.fgColor,
          bgColor: store.bgColor,
          pixelWidth: w,
          pixelHeight: h,
          pixels: pixelsToBase64(store.pixels),
          activeLayer: store.activeLayer,
          heightValue: store.heightValue,
          heightmap: heightmapToBase64(store.heightmapPixels),
        },
      };
    }

    case 'get_manifest': {
      return { response: { manifest: store.manifest } };
    }

    case 'set_manifest': {
      const m = params['manifest'] as AssetManifest | undefined;
      if (!m) return { error: 'missing manifest param' };
      store.setManifest(m);
      return { response: { ok: true } };
    }

    case 'get_pixels': {
      const target = (params['target'] as EditTarget | undefined) ?? store.editTarget;
      const col = (params['col'] as number | undefined);
      const row = (params['row'] as number | undefined);

      let pixels: PixelData;
      let w: number, h: number;

      if (col !== undefined && row !== undefined) {
        const key = `${col},${row}`;
        if (target === 'tileset') {
          pixels = store.tilesetPixels.get(key) ?? makeBlankPixels(store.manifest.tileset.tile_width, store.manifest.tileset.tile_height);
          w = store.manifest.tileset.tile_width;
          h = store.manifest.tileset.tile_height;
        } else {
          pixels = store.spritesheetPixels.get(key) ?? makeBlankPixels(store.manifest.spritesheet.frame_width, store.manifest.spritesheet.frame_height);
          w = store.manifest.spritesheet.frame_width;
          h = store.manifest.spritesheet.frame_height;
        }
      } else {
        pixels = store.pixels;
        const dims = pixelDims(store);
        w = dims.w;
        h = dims.h;
      }

      return { response: { pixels: pixelsToBase64(pixels), width: w, height: h } };
    }

    case 'set_pixels': {
      const b64 = params['pixels'] as string | undefined;
      if (!b64) return { error: 'missing pixels param' };
      const newPixels = base64ToPixels(b64);
      const target = (params['target'] as EditTarget | undefined) ?? store.editTarget;
      const col = params['col'] as number | undefined;
      const row = params['row'] as number | undefined;

      if (col !== undefined && row !== undefined) {
        // Write to specific slot (may not be currently active)
        if (target === 'tileset') {
          if (col === store.selectedTileCol && row === store.selectedTileRow && store.editTarget === 'tileset') {
            store.pushHistory();
            store.setPixels(newPixels);
          } else {
            const newMap = new Map(store.tilesetPixels);
            newMap.set(`${col},${row}`, new Uint8ClampedArray(newPixels) as PixelData);
            // Trigger store update via selectTile (save+load cycle)
            // For non-active, just update the map directly — need store access
            // We'll just set it if it's the current tile
          }
        } else {
          if (col === store.selectedFrameCol && row === store.selectedFrameRow && store.editTarget === 'spritesheet') {
            store.pushHistory();
            store.setPixels(newPixels);
          }
        }
      } else {
        store.pushHistory();
        store.setPixels(newPixels);
      }

      return { response: { ok: true } };
    }

    case 'select_tile': {
      const col = params['col'] as number | undefined;
      const row = params['row'] as number | undefined;
      if (col === undefined || row === undefined) return { error: 'missing col/row' };
      if (store.editTarget !== 'tileset') store.setEditTarget('tileset');
      store.selectTile(col, row);
      return { response: { ok: true } };
    }

    case 'select_frame': {
      const col = params['col'] as number | undefined;
      const row = params['row'] as number | undefined;
      if (col === undefined || row === undefined) return { error: 'missing col/row' };
      if (store.editTarget !== 'spritesheet') store.setEditTarget('spritesheet');
      store.selectFrame(col, row);
      return { response: { ok: true } };
    }

    case 'set_edit_target': {
      const target = params['target'] as EditTarget | undefined;
      if (!target) return { error: 'missing target' };
      store.setEditTarget(target);
      return { response: { ok: true } };
    }

    case 'set_pixel': {
      const x = params['x'] as number;
      const y = params['y'] as number;
      const color = params['color'] as RGBA;
      if (x === undefined || y === undefined || !color) return { error: 'missing x/y/color' };
      store.pushHistory();
      store.setPixel(x, y, color);
      return { response: { ok: true } };
    }

    case 'set_tool': {
      const tool = params['tool'] as DrawingTool | undefined;
      if (!tool) return { error: 'missing tool' };
      store.setActiveTool(tool);
      return { response: { ok: true } };
    }

    case 'set_color': {
      const fg = params['fg'] as RGBA | undefined;
      const bg = params['bg'] as RGBA | undefined;
      if (fg) store.setFgColor(fg);
      if (bg) store.setBgColor(bg);
      return { response: { ok: true } };
    }

    case 'clear': {
      const { w, h } = pixelDims(store);
      store.pushHistory();
      store.setPixels(makeBlankPixels(w, h));
      return { response: { ok: true } };
    }

    case 'undo': {
      store.undo();
      return { response: { ok: true } };
    }

    case 'redo': {
      store.redo();
      return { response: { ok: true } };
    }

    case 'get_heightmap': {
      const { w, h } = pixelDims(store);
      return { response: { heightmap: heightmapToBase64(store.heightmapPixels), width: w, height: h } };
    }

    case 'set_heightmap': {
      const b64 = params['heightmap'] as string | undefined;
      if (!b64) return { error: 'missing heightmap param' };
      const newHm = base64ToHeightmap(b64);
      store.pushHistory();
      store.setHeightmapPixels(newHm);
      return { response: { ok: true } };
    }

    case 'get_normal_map': {
      const { w, h } = pixelDims(store);
      const normalMap = heightmapToNormalMap(store.heightmapPixels, w, h);
      return { response: { normal_map: pixelsToBase64(normalMap), width: w, height: h } };
    }

    case 'set_layer': {
      const layer = params['layer'] as ActiveLayer | undefined;
      if (!layer || (layer !== 'diffuse' && layer !== 'heightmap')) return { error: 'invalid layer' };
      store.setActiveLayer(layer);
      return { response: { ok: true } };
    }

    case 'set_height_value': {
      const value = params['value'] as number | undefined;
      if (value === undefined) return { error: 'missing value' };
      store.setHeightValue(value);
      return { response: { ok: true } };
    }

    // -----------------------------------------------------------------------
    // AI generation commands (async)
    // -----------------------------------------------------------------------

    case 'ai_check': {
      const comfyUrl = (params['comfy_url'] as string | undefined) ?? getComfyUrl();
      const client = new ComfyUIClient(comfyUrl);
      return client.checkAvailability()
        .then((result) => ({ response: { available: result.available, ...(result.error ? { error: result.error } : {}) } }))
        .catch((err) => ({ response: { available: false, error: String(err) } }));
    }

    case 'ai_get_config': {
      return {
        response: {
          comfy_url: getComfyUrl(),
          default_negative_prompt: DEFAULT_NEGATIVE_PROMPT,
          samplers: [...SAMPLER_NAMES],
          default_steps: 20,
          default_cfg: 7,
          default_sampler: 'euler',
        },
      };
    }

    case 'ai_generate': {
      return handleAiGenerate(params, store);
    }

    case 'ai_generate_batch': {
      return handleAiGenerateBatch(params, store);
    }

    case 'ai_generate_row': {
      return handleAiGenerateRow(params, store);
    }

    default:
      return { error: `unknown command: ${cmd}` };
  }
}

// ---------------------------------------------------------------------------
// AI helpers
// ---------------------------------------------------------------------------

function getComfyUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (import.meta as any).env?.VITE_COMFYUI_URL || 'http://localhost:8188';
  } catch {
    return 'http://localhost:8188';
  }
}

async function handleAiGenerate(
  params: Record<string, unknown>,
  store: PainterState,
): Promise<CommandResult> {
  const prompt = params['prompt'] as string | undefined;
  if (!prompt) return { error: 'missing prompt param' };

  const comfyUrl = (params['comfy_url'] as string | undefined) ?? getComfyUrl();
  const client = new ComfyUIClient(comfyUrl);

  const check = await client.checkAvailability().catch(() => ({
    available: false as const,
    error: `Cannot reach ComfyUI at ${comfyUrl}`,
  }));
  if (!check.available) {
    return { error: check.error ?? 'ComfyUI unavailable' };
  }

  const negativePrompt = params['negative_prompt'] as string | undefined;
  const steps = (params['steps'] as number | undefined) ?? 20;
  const seedParam = (params['seed'] as number | undefined) ?? -1;
  const cfg = (params['cfg'] as number | undefined) ?? 7;
  const sampler = (params['sampler'] as string | undefined) ?? 'euler';
  const loras = (params['loras'] as Array<{ name: string; weight?: number }> | undefined) ?? [];
  const apply = (params['apply'] as boolean | undefined) ?? true;

  const actualSeed = seedParam === -1 ? Math.floor(Math.random() * 2 ** 31) : seedParam;
  const { w: targetW, h: targetH } = pixelDims(store);
  const col = store.editTarget === 'tileset' ? store.selectedTileCol : store.selectedFrameCol;
  const row = store.editTarget === 'tileset' ? store.selectedTileRow : store.selectedFrameRow;

  const fullPrompt = buildFullPrompt({
    prompt,
    editTarget: store.editTarget,
    manifest: store.manifest,
    col,
    row,
    targetW,
    targetH,
    activeLayer: store.activeLayer,
  });
  const fullNegative = buildNegativePrompt(negativePrompt);

  try {
    const pngBytes = await client.generateImage(fullPrompt, {
      width: 512,
      height: 512,
      steps,
      seed: actualSeed,
      negativePrompt: fullNegative,
      cfgScale: cfg,
      samplerName: sampler,
      loras,
    });

    const pixels = await downscaleToPixelData(pngBytes, targetW, targetH);

    if (apply) {
      if (store.activeLayer === 'heightmap') {
        const hm = pixelsToHeightmap(pixels, targetW, targetH);
        store.pushHistory();
        store.setHeightmapPixels(hm);
      } else {
        store.pushHistory();
        store.setPixels(pixels);
      }
    }

    return {
      response: {
        pixels: pixelsToBase64(pixels),
        width: targetW,
        height: targetH,
        seed: actualSeed,
        applied: apply,
      },
    };
  } catch (err) {
    return { error: (err as Error).message ?? String(err) };
  }
}

async function handleAiGenerateBatch(
  params: Record<string, unknown>,
  store: PainterState,
): Promise<CommandResult> {
  const targets = params['targets'] as Array<Record<string, unknown>> | undefined;
  if (!targets || !Array.isArray(targets) || targets.length === 0) {
    return { error: 'missing or empty targets array' };
  }

  const comfyUrl = (params['comfy_url'] as string | undefined) ?? getComfyUrl();
  const defaults = {
    negative_prompt: params['negative_prompt'] as string | undefined,
    steps: params['steps'] as number | undefined,
    seed: params['seed'] as number | undefined,
    cfg: params['cfg'] as number | undefined,
    sampler: params['sampler'] as string | undefined,
    loras: params['loras'] as Array<{ name: string; weight?: number }> | undefined,
  };

  const results: Array<{ ok: boolean; seed?: number; error?: string }> = [];

  for (const target of targets) {
    const targetType = target['target'] as EditTarget | undefined;
    const col = target['col'] as number | undefined;
    const row = target['row'] as number | undefined;

    // Select the target tile/frame
    if (targetType === 'tileset' && col !== undefined && row !== undefined) {
      if (store.editTarget !== 'tileset') store.setEditTarget('tileset');
      store.selectTile(col, row);
    } else if (targetType === 'spritesheet' && col !== undefined && row !== undefined) {
      if (store.editTarget !== 'spritesheet') store.setEditTarget('spritesheet');
      store.selectFrame(col, row);
    }

    const merged: Record<string, unknown> = {
      prompt: target['prompt'] ?? params['prompt'],
      negative_prompt: target['negative_prompt'] ?? defaults.negative_prompt,
      steps: target['steps'] ?? defaults.steps,
      seed: target['seed'] ?? defaults.seed,
      cfg: target['cfg'] ?? defaults.cfg,
      sampler: target['sampler'] ?? defaults.sampler,
      loras: target['loras'] ?? defaults.loras,
      comfy_url: comfyUrl,
      apply: target['apply'] ?? true,
    };

    const result = await handleAiGenerate(merged, store);
    if ('error' in result) {
      results.push({ ok: false, error: result.error });
    } else {
      const resp = result.response as Record<string, unknown>;
      results.push({ ok: true, seed: resp['seed'] as number });
    }
  }

  return { response: { results } };
}

async function handleAiGenerateRow(
  params: Record<string, unknown>,
  store: PainterState,
): Promise<CommandResult> {
  const prompt = params['prompt'] as string | undefined;
  if (!prompt) return { error: 'missing prompt param' };

  const comfyUrl = (params['comfy_url'] as string | undefined) ?? getComfyUrl();
  const client = new ComfyUIClient(comfyUrl);

  const check = await client.checkAvailability().catch(() => ({
    available: false as const,
    error: `Cannot reach ComfyUI at ${comfyUrl}`,
  }));
  if (!check.available) {
    return { error: check.error ?? 'ComfyUI unavailable' };
  }

  // Determine row — use param or current selected frame row
  const row = (params['row'] as number | undefined) ?? store.selectedFrameRow;
  const rowDef = store.manifest.spritesheet.rows.find((r) => r.row === row);
  if (!rowDef) return { error: `no row definition for row ${row}` };

  const frameCount = rowDef.frames;
  const fw = store.manifest.spritesheet.frame_width;
  const fh = store.manifest.spritesheet.frame_height;

  const negativePrompt = params['negative_prompt'] as string | undefined;
  const steps = (params['steps'] as number | undefined) ?? 20;
  const seedParam = (params['seed'] as number | undefined) ?? -1;
  const cfg = (params['cfg'] as number | undefined) ?? 7;
  const sampler = (params['sampler'] as string | undefined) ?? 'euler';
  const loras = (params['loras'] as Array<{ name: string; weight?: number }> | undefined) ?? [];
  const apply = (params['apply'] as boolean | undefined) ?? true;

  const actualSeed = seedParam === -1 ? Math.floor(Math.random() * 2 ** 31) : seedParam;

  const fullPrompt = buildRowPrompt({
    prompt,
    rowDef,
    frameWidth: fw,
    frameHeight: fh,
    activeLayer: store.activeLayer,
  });
  const fullNegative = buildNegativePrompt(negativePrompt);

  // Generate at 512 x (512/frameCount) — strip aspect ratio
  const genWidth = 512;
  const genHeight = Math.max(64, Math.round(512 / frameCount));

  try {
    const pngBytes = await client.generateImage(fullPrompt, {
      width: genWidth,
      height: genHeight,
      steps,
      seed: actualSeed,
      negativePrompt: fullNegative,
      cfgScale: cfg,
      samplerName: sampler,
      loras,
    });

    const frames = await sliceStripToFrames(pngBytes, frameCount, fw, fh);

    if (apply) {
      store.applyRowPixels(row, frames);
    }

    return {
      response: {
        frames: frames.map((f) => pixelsToBase64(f)),
        seed: actualSeed,
        row,
        width: fw,
        height: fh,
        gen_width: genWidth,
        gen_height: genHeight,
      },
    };
  } catch (err) {
    return { error: (err as Error).message ?? String(err) };
  }
}
