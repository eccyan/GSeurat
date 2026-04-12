# Phase 0.2.1 — Echidna Follow-ups

Five small fixes deferred from Phase 0.2 Multi-Character Management.

## 1. NewProjectDialog Character Name Prompt

**Problem:** `NewProjectDialog` only asks for grid size. New characters are always named "Untitled" with an auto-suffix id (`untitled`, `untitled_2`, …). Users must rename after creation.

**Fix:**

- Add a "Character Name" text input to `NewProjectDialog.tsx`, default empty, autofocused.
- On Create: pass the entered name (or `"Untitled"` if blank) to `newCharacter()`.
- Extend `newCharacter(gridSize?, name?)` to accept an optional name parameter. Derive the id from `slugifyCharacterId(name)` instead of always using `"Untitled"`.
- The collision-suffix loop already handles duplicate ids — no change needed there beyond using the provided name as the base.

**Files:**
- `tools/apps/echidna/src/panels/NewProjectDialog.tsx` — add name input
- `tools/apps/echidna/src/store/useCharacterStore.ts` — `newCharacter` signature + body

## 2. `saveProject` DTO Null Fallback → Hard Throw

**Problem:** `saveProject()` at line 1208-1211 falls back to `DEFAULT_CHARACTER` with `console.warn` when `character` is null. This silently produces garbage output. Every caller already guards `character !== null` before calling, so reaching this path is a programmer error.

**Fix:**

- Replace the `console.warn` + `?? DEFAULT_CHARACTER` fallback with `throw new Error('[echidna] saveProject called with null character')`.
- Remove the `DEFAULT_CHARACTER` const if it has no other consumers (check first).

**Files:**
- `tools/apps/echidna/src/store/useCharacterStore.ts` — `saveProject()` method

## 3. `save()` Returns Boolean

**Problem:** `save()` returns `Promise<void>`. Callers detect failure by checking `get().dirty` after save, which is indirect and fragile.

**Fix:**

- Change signature: `save(): Promise<boolean>`.
- Return `true` at the success path (after `set({ dirty: false, ... })`).
- Return `false` at every early-return / error path (no handle, no character, write failures, race guard).
- In `requestOpenCharacter`, replace the `get().dirty` check with `const ok = await s.save(); if (!ok) return;`.
- Update the `CharacterStoreState` interface type.

**Files:**
- `tools/apps/echidna/src/store/useCharacterStore.ts` — `save()`, `requestOpenCharacter()`, interface

## 4. Rename Semantics — Eager Persist for Current Character

**Problem:** Renaming the currently-open character only updates in-memory state. The disk rename happens on next `save()`. Renaming a non-current character writes to disk immediately. This asymmetry is confusing.

**Fix:**

- In `renameCharacter()`, when `id === state.character?.id`, also call `renameEchidnaProject(handle, id, newName)` on disk (same as the non-current path). The in-memory `character.characterName` update stays.
- After the disk rename, update the character's `id` in state to the new slugified id (since the file was renamed on disk).

**Files:**
- `tools/apps/echidna/src/store/useCharacterStore.ts` — `renameCharacter()` method

## 5. CharactersPanel Smoke Test

**Problem:** No render test exists for `CharactersPanel`. This component has conditional rendering (collapsed state, dirty indicator, current-character highlight) that should have basic coverage.

**Fix:**

- Create `tools/apps/echidna/src/__tests__/CharactersPanel.test.tsx`.
- Mock `useCharacterStore` to provide controlled state (`knownCharacters`, `character`, `dirty`).
- Test cases:
  - Renders character rows matching `knownCharacters`
  - Shows dirty indicator (orange dot) when `dirty: true` for current character
  - Highlights current character row
  - Renders empty state when `knownCharacters` is empty
- No click/interaction tests — those require dialog mocking (out of scope).

**Files:**
- `tools/apps/echidna/src/__tests__/CharactersPanel.test.tsx` (new)

## Testing Strategy

- Items 1-4: extend existing `characterStore.test.ts` with targeted test cases
- Item 5: new RTL render test file
- All items: `pnpm build` in `tools/` must pass
