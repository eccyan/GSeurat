# Phase 0.3c — Méliès Asset Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Object element's file picker with an asset dropdown that lists PLY files from `assets/objects/`.

**Architecture:** Add a `listObjectPlys` helper to scan `assets/objects/`, replace the file picker UI in LayerProperties with a `<select>` dropdown. `copyPlyToProject` and `loadPlyFromProject` are NOT deleted — the scene backdrop feature still uses them. ObjectGizmo needs no changes since `loadPlyFromProject` handles any relative path.

**Tech Stack:** React, TypeScript, File System Access API, `@gseurat/project-root`

**Important correction from spec:** The spec said to delete `copyPlyToProject` and `loadPlyFromProject`, but these are also used by the scene backdrop PLY feature in `App.tsx`. They must stay. Only the Object element's Import UI changes.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tools/apps/melies/src/lib/projectIO.ts` | Modify | Add `listObjectPlys` helper |
| `tools/apps/melies/src/panels/LayerProperties.tsx` | Modify | Replace file picker with asset dropdown |
| `tools/apps/melies/src/lib/__tests__/projectIO.test.ts` | Modify | Test `listObjectPlys` |

---

### Task 1: Add listObjectPlys helper

**Files:**
- Modify: `tools/apps/melies/src/lib/projectIO.ts`
- Test: `tools/apps/melies/src/lib/__tests__/projectIO.test.ts`

- [ ] **Step 1: Write failing test**

In `tools/apps/melies/src/lib/__tests__/projectIO.test.ts`, add:

```typescript
import { listObjectPlys } from '../projectIO';
import { testing } from '@gseurat/project-root';

describe('listObjectPlys', () => {
  it('returns .ply filenames from assets/objects/', async () => {
    const root = testing.makeRoot();
    const assets = await root.getDirectoryHandle('assets', { create: true });
    const objects = await assets.getDirectoryHandle('objects', { create: true });
    const fh1 = await objects.getFileHandle('crystal.ply', { create: true });
    const w1 = await fh1.createWritable();
    await w1.write(new Uint8Array([1]));
    await w1.close();
    const fh2 = await objects.getFileHandle('barrel.ply', { create: true });
    const w2 = await fh2.createWritable();
    await w2.write(new Uint8Array([2]));
    await w2.close();
    // Non-PLY file should be excluded
    const fh3 = await objects.getFileHandle('readme.txt', { create: true });
    const w3 = await fh3.createWritable();
    await w3.write('ignore');
    await w3.close();

    const result = await listObjectPlys(root as unknown as FileSystemDirectoryHandle);
    expect(result.sort()).toEqual(['barrel.ply', 'crystal.ply']);
  });

  it('returns empty array when assets/objects/ does not exist', async () => {
    const root = testing.makeRoot();
    const result = await listObjectPlys(root as unknown as FileSystemDirectoryHandle);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies test -- --run --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `listObjectPlys` does not exist

- [ ] **Step 3: Implement listObjectPlys**

In `tools/apps/melies/src/lib/projectIO.ts`, add at the end of the file:

```typescript
/**
 * List all .ply filenames in assets/objects/.
 * Returns an array of filenames (e.g., ['crystal.ply', 'barrel.ply']).
 * Returns [] if the directory doesn't exist.
 */
export async function listObjectPlys(
  handle: FileSystemDirectoryHandle,
): Promise<string[]> {
  let dir: FileSystemDirectoryHandle;
  try {
    const assets = await handle.getDirectoryHandle('assets');
    dir = await assets.getDirectoryHandle('objects');
  } catch (e) {
    if ((e as Error).name === 'NotFoundError') return [];
    throw e;
  }

  type DirChild = { kind: string; name: string };
  const iter = (dir as unknown as { values(): AsyncIterable<DirChild> }).values();
  const names: string[] = [];
  for await (const child of iter) {
    if (child.kind === 'file' && child.name.endsWith('.ply')) {
      names.push(child.name);
    }
  }
  return names;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tools/apps/melies/src/lib/projectIO.ts tools/apps/melies/src/lib/__tests__/projectIO.test.ts
git commit -m "feat(melies): add listObjectPlys helper"
```

---

### Task 2: Replace file picker with asset dropdown in LayerProperties

**Files:**
- Modify: `tools/apps/melies/src/panels/LayerProperties.tsx`

- [ ] **Step 1: Replace the Object Config import section**

In `tools/apps/melies/src/panels/LayerProperties.tsx`, find the Object Config section (around lines 704-745). Replace the entire `{layer.type === 'object' && (...)}` block with:

```tsx
      {layer.type === 'object' && (
        <>
          <SectionHeader>Object Config</SectionHeader>
          <div>
            <label style={sectionLabel}>PLY File</label>
            <ObjectPlyPicker
              value={layer.ply_file ?? ''}
              onChange={(path) => update({ ply_file: path || undefined })}
            />
          </div>
          <div>
            <label style={sectionLabel}>Scale</label>
            <NumberInput value={layer.scale ?? 1} min={0.01} step={0.1}
              onChange={(v) => update({ scale: v })} style={{ ...inputStyle, width: 'auto' }} />
          </div>
        </>
      )}
```

- [ ] **Step 2: Create the ObjectPlyPicker component**

Add this component inside `LayerProperties.tsx` (above the main export, or at the top of the file after imports):

```tsx
import { useVfxStore } from '../store/useVfxStore.js';

function ObjectPlyPicker({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = useVfxStore.getState().projectHandle;
    if (!handle) return;
    setLoading(true);
    import('../lib/projectIO.js').then(({ listObjectPlys }) =>
      listObjectPlys(handle).then((names) => {
        setOptions(names);
        setLoading(false);
      }),
    ).catch(() => setLoading(false));
  }, []);

  // Derive selected filename from full path (e.g., 'assets/objects/crystal.ply' → 'crystal.ply')
  const selectedFile = value.includes('/') ? value.split('/').pop() ?? '' : value;

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <select
        style={{ ...inputStyle, flex: 1, opacity: value ? 1 : 0.5 }}
        value={selectedFile}
        onChange={(e) => {
          const file = e.target.value;
          onChange(file ? `assets/objects/${file}` : '');
        }}
      >
        <option value="">
          {loading ? 'Loading…' : 'None'}
        </option>
        {options.map((name) => (
          <option key={name} value={name}>{name.replace(/\.ply$/i, '')}</option>
        ))}
      </select>
    </div>
  );
}
```

Note: `inputStyle` is a local style already defined in LayerProperties.tsx — the ObjectPlyPicker should use it. Check that `inputStyle` is accessible (it's defined as a const in the file scope, so it should be). Also check that `useState` and `useEffect` are already imported from React at the top of the file.

Also check that `useVfxStore` is already imported in LayerProperties.tsx. If not, add the import.

- [ ] **Step 3: Remove the old file picker code**

Make sure the old `<input type="file">` / "Import" button code (the `document.createElement('input')` block) is completely removed from the Object Config section. The `copyPlyToProject` dynamic import in this file should be gone.

- [ ] **Step 4: Run build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -10`
Expected: Build succeeds

- [ ] **Step 5: Run tests**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies test -- --run --reporter verbose 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add tools/apps/melies/src/panels/LayerProperties.tsx
git commit -m "feat(melies): replace Object file picker with asset dropdown"
```

---

### Task 3: Final build verification

- [ ] **Step 1: Run melies tests**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm --filter melies test -- --run --reporter verbose`
Expected: all PASS

- [ ] **Step 2: Run build**

Run: `cd /Users/eccyan/dev/GSeurat/tools && pnpm build 2>&1 | tail -20`
Expected: Build succeeds for melies
