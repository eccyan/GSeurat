# Echidna Selection Actions

## Goal

Complete the selection → bone assignment workflow in Echidna. Add Assign, Unassign, and Clear Selection buttons that operate on the current box/lasso selection. Currently the user can build a selection but has no way to commit it to (or remove it from) a bone through the UI.

## Current gap

The `assign_part` tool paints individual voxels one-at-a-time. The selection (`boxSelection`, `lassoSelection`) has no UI action to commit to a bone. This design closes that gap and adds the symmetric unassign operation.

## Workflow

Both Assign and Unassign use the same symmetric model:

1. Pick **Target Bone** from the dropdown
2. Build **Selection** via Box Select (S) or Lasso (L)
3. Click **Assign to Bone** or **Unassign** — operates on `(selection, targetBone)` pair

Since voxels can only belong to one bone at a time, Unassign is effectively "remove these voxels from this specific bone" — no-op for voxels not currently in the target bone.

## Architecture

### Store changes

Add new action `unassignVoxelsFromPart(keys: VoxelKey[], partId: string)`:

- For the bone with `id === partId`, filter out voxel keys from `voxelKeys`
- Other bones untouched
- Applies mirror handling (same as `assignVoxelsToPart`)
- Marks dirty

The existing `assignVoxelsToPart` handles the Assign case — no changes needed.

The existing `setBoxSelection(null)` and `setLassoSelection(null)` handle Clear — we call both from a single Clear button.

### UI changes

New "Selection" section in `AnimateToolBar`, below the Target Bone dropdown:

```
┌─────────────────────┐
│ SELECTION           │
├─────────────────────┤
│ 42 voxels selected  │
├─────────────────────┤
│ [ Assign to Bone  ] │
│ [ Unassign        ] │
│ [ Clear Selection ] │
└─────────────────────┘
```

- **Count display** shows `boxSelection.length + lassoSelection.length` (either or both can be active)
- **Assign to Bone**: calls `assignVoxelsToPart(selection, targetBone)`. Disabled if no selection or no target bone.
- **Unassign**: calls `unassignVoxelsFromPart(selection, targetBone)`. Disabled if no selection or no target bone.
- **Clear Selection**: calls `setBoxSelection(null)` + `setLassoSelection(null)`. Disabled if no selection.

Both Assign and Unassign call `pushUndo()` before mutation and clear the selection after (so the user sees the green tint disappear as confirmation).

### Selection derivation

"Current selection" = union of `boxSelection` and `lassoSelection` (de-duplicated). A helper in the AnimateToolBar component computes this from the store. No new store field.

## Files changed

| File | Change |
|------|--------|
| `tools/apps/echidna/src/store/useCharacterStore.ts` | Add `unassignVoxelsFromPart` action + interface entry |
| `tools/apps/echidna/src/panels/AnimateToolBar.tsx` | Add Selection section with 3 buttons + count display |
| `tools/apps/echidna/src/__tests__/unassignVoxelsFromPart.test.ts` | Unit tests |

## Testing

**Unit tests** (`unassignVoxelsFromPart.test.ts`):
- Assign voxel to bone A, then unassign from bone A → voxel no longer in bone A
- Unassign voxel not in target bone → no-op (voxel stays in its current bone)
- Unassign from non-existent bone → no-op, no error
- Empty keys array → no-op

**Manual verification:**
- Box select voxels → pick bone → click Assign → voxels now assigned
- Box select voxels → pick bone → click Unassign → voxels removed from that bone
- Click Clear Selection → both selections cleared, buttons disabled again

## Out of scope

- Keyboard shortcuts for Assign/Unassign (can add later if needed)
- Cross-bone "move" operation (just use Assign — it already removes from other bones)
- Bulk operations across multiple selections (YAGNI)
