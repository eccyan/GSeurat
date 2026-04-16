# Echidna Depth AI Image Import

## Goal

Add image import to Echidna using Depth Anything V2 for depth estimation, producing editable voxel maps from photographs or AI-generated images. The primary use case is generating game maps from images.

## Architecture

### Shared depth estimation

Move `depthEstimate.ts` from `tools/apps/bricklayer/src/lib/` to `tools/packages/ai-providers/src/depthEstimate.ts`. Export `estimateDepth()` from the package index. Update Bricklayer's import to use `@gseurat/ai-providers`.

The `@huggingface/transformers` dependency moves to `ai-providers`'s `package.json`. The model (`onnx-community/depth-anything-v2-small`, ~50 MB) is cached in browser IndexedDB and shared across apps.

### Echidna UI

**New `ImageImportDialog.tsx`** in `tools/apps/echidna/src/panels/`:
- File picker (`accept="image/*"`)
- Depth AI only (no mode selector)
- Voxel Budget input (default 500K, range 10K–5M)
- Progress bar for model download + depth estimation
- Triggered from MenuBar: File -> "Import Image..."

No Max Grid / Max Z sliders. The image is scaled to fit the current asset's `gridWidth` (X/Y plane), and depth columns extend along Z scaled to `gridDepth`.

### Voxelization logic

**New `imageImport.ts`** in `tools/apps/echidna/src/lib/`:

```ts
export function imageToVoxels(
  imageData: ImageData,
  depthMap: Float32Array,
  gridWidth: number,
  gridDepth: number,
): { voxels: Map<VoxelKey, Voxel>; parts: BodyPart[] }
```

Algorithm:
1. Downscale image to `gridWidth` pixels wide (preserve aspect ratio).
2. For each pixel `(ix, iy)`:
   - Read RGBA; skip if alpha < 10.
   - `vy = height - 1 - iy` (flip Y so image top = high Y).
   - `depth = depthMap[iy * width + ix]` (0 = close, 1 = far).
   - `colHeight = max(1, round(depth * gridDepth))`.
   - Create voxels at `(ix, vy, 0..colHeight)` with pixel color.
3. Surface culling: remove voxels with all 6 neighbors present.
4. Budget trimming: if voxel count exceeds budget, stride-sample uniformly.

Returns a single "root" `BodyPart` containing all voxel keys, with joint at centroid.

### Store integration

**New `importFromImage` action** in `useCharacterStore`:
- Accepts `{ voxels, parts, gridWidth, gridDepth }`.
- Sets `asset.kind = 'map'`.
- Pushes undo before applying.
- Marks dirty.

## Data flow

```
Image file
  -> downscale to gridWidth px
  -> Depth Anything V2 (via @gseurat/ai-providers)
  -> normalized depth map (Float32Array, 0..1)
  -> imageToVoxels(imageData, depthMap, gridWidth, gridDepth)
  -> surface culling + budget trimming
  -> useCharacterStore.importFromImage()
  -> editable voxel map in Echidna
```

## Testing

- **Unit test** (`imageImport.test.ts`): synthetic 4x4 ImageData + fake depth map -> verify voxel count, colors, grid bounds, surface culling.
- **Bricklayer regression**: existing depth import still works after moving `depthEstimate.ts` to `@gseurat/ai-providers`.

## Files changed

| File | Change |
|------|--------|
| `tools/packages/ai-providers/src/depthEstimate.ts` | New (moved from Bricklayer) |
| `tools/packages/ai-providers/src/index.ts` | Export `estimateDepth` |
| `tools/packages/ai-providers/package.json` | Add `@huggingface/transformers` dependency |
| `tools/apps/bricklayer/src/lib/depthEstimate.ts` | Delete |
| `tools/apps/bricklayer/src/panels/ImportDialog.tsx` | Import from `@gseurat/ai-providers` |
| `tools/apps/echidna/src/lib/imageImport.ts` | New — `imageToVoxels()` |
| `tools/apps/echidna/src/panels/ImageImportDialog.tsx` | New — import dialog UI |
| `tools/apps/echidna/src/panels/MenuBar.tsx` | Add "Import Image..." menu item |
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Add `importFromImage` action |
| `tools/apps/echidna/src/__tests__/imageImport.test.ts` | New — unit test |
