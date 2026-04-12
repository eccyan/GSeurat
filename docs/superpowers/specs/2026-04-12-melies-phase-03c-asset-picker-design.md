# Phase 0.3c — Méliès Object Element Asset Picker

Replace the file picker for Object elements with an asset dropdown that lists PLY files from `assets/objects/`.

## 1. Asset Picker Replaces File Picker

In `LayerProperties.tsx`, the Object Config section changes:

- **Remove** the `<input type="file">` "Import" button and its inline handler
- **Add** a `<select>` dropdown listing all `.ply` files in `assets/objects/`
- On selection, sets `ply_file` to `assets/objects/{filename}` (e.g., `assets/objects/crystal.ply`)
- A "None" / empty option clears the `ply_file` field
- The read-only text input showing the current path stays (shows selected path or "No file selected")

## 2. Remove Legacy scene/ PLY Helpers

- **Delete** `copyPlyToProject(handle, file)` from `projectIO.ts` — no longer needed; objects come from Echidna via `assets/objects/`
- **Delete** `loadPlyFromProject(handle, relativePath)` from `projectIO.ts` — replaced by direct `readFileAtPath` from `@gseurat/project-root`
- **Update** `Preview.tsx` ObjectGizmo: load PLY via `readFileAtPath(projectHandle, ply_file)` instead of `loadPlyFromProject`
- Remove any imports of the deleted functions

## 3. Listing Objects from Filesystem

Add `listObjectPlys(handle: FileSystemDirectoryHandle): Promise<string[]>` to `projectIO.ts`:

- Scans `assets/objects/` directory via FSAPI `values()` iterator
- Returns filenames ending in `.ply` (e.g., `['crystal.ply', 'barrel.ply']`)
- Returns `[]` if the directory doesn't exist (NotFoundError catch)
- No registry coupling — pure filesystem scan

The LayerProperties panel calls this when the Object Config section mounts to populate the dropdown options.

## 4. Scope Boundary

### In scope

- Asset picker dropdown in LayerProperties Object Config
- `listObjectPlys` helper
- Remove `copyPlyToProject` and `loadPlyFromProject`
- Update ObjectGizmo PLY loading to use `readFileAtPath`

### Out of scope

- Registry-based resolution (`#id` refs)
- VFX project version bump / migration
- `scene/` directory cleanup (old files stay on disk)
- Any changes to emitter/animation/light element types
