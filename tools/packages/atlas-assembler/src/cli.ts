#!/usr/bin/env tsx
/**
 * Atlas Assembler CLI
 *
 * Usage:
 *   npx atlas-assembler --character <id>      Assemble one character
 *   npx atlas-assembler --all                 Assemble all characters
 *   npx atlas-assembler --validate <id>       Dry-run validation
 *   npx atlas-assembler --init <id> <name>    Create new character manifest
 */

import { assembleCharacterAtlas, initCharacter, listCharacters } from "./index.js";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`Atlas Assembler — Sprite sheet assembly tool

Usage:
  atlas-assembler --character <id>            Assemble sprite sheet for character
  atlas-assembler --all                       Assemble all characters
  atlas-assembler --validate --character <id> Validate without writing
  atlas-assembler --init <id> <display_name>  Create new character with default manifest
  atlas-assembler --list                      List all characters with manifests`);
    process.exit(0);
  }

  // --init <id> <name>
  if (args.includes("--init")) {
    const initIdx = args.indexOf("--init");
    const id = args[initIdx + 1];
    const name = args[initIdx + 2];
    if (!id || !name) {
      console.error("Error: --init requires <id> and <display_name>");
      process.exit(1);
    }
    const manifest = await initCharacter(id, name);
    console.log(`Created character "${manifest.display_name}" (${manifest.character_id})`);
    console.log(`  ${manifest.animations.length} animations, ${manifest.animations[0]?.frames.length ?? 0} frames each`);
    console.log(`  Manifest: assets/characters/${id}/manifest.json`);
    return;
  }

  // --list
  if (args.includes("--list")) {
    const ids = await listCharacters();
    if (ids.length === 0) {
      console.log("No characters found.");
    } else {
      console.log(`Characters (${ids.length}):`);
      for (const id of ids) console.log(`  - ${id}`);
    }
    return;
  }

  const validate = args.includes("--validate");
  const assembleAll = args.includes("--all");

  if (assembleAll) {
    const ids = await listCharacters();
    if (ids.length === 0) {
      console.log("No characters found.");
      return;
    }
    for (const id of ids) {
      console.log(`\nAssembling: ${id}`);
      await assembleOne(id, validate);
    }
    return;
  }

  // --character <id>
  const charIdx = args.indexOf("--character");
  if (charIdx >= 0) {
    const id = args[charIdx + 1];
    if (!id) {
      console.error("Error: --character requires an id");
      process.exit(1);
    }
    await assembleOne(id, validate);
    return;
  }

  console.error("Error: no command specified. Use --help for usage.");
  process.exit(1);
}

async function assembleOne(characterId: string, validate: boolean) {
  try {
    const result = await assembleCharacterAtlas(characterId, { validate });

    console.log(`  Total frames:       ${result.totalFrames}`);
    console.log(`  Approved:           ${result.approvedFrames}`);
    console.log(`  Placeholder:        ${result.placeholderFrames}`);
    console.log(`  Rejected:           ${result.rejectedFrames}`);

    if (result.warnings.length > 0) {
      console.log(`  Warnings:`);
      for (const w of result.warnings) console.log(`    - ${w}`);
    }

    if (result.errors.length > 0) {
      console.log(`  Errors:`);
      for (const e of result.errors) console.log(`    - ${e}`);
    }

    if (!validate) {
      console.log(`  Output: ${result.spritesheet}`);
      console.log(`  Animations: ${result.animationsJson}`);
    }
  } catch (err) {
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
