// Unit tests for pure path builders. The async save/load/export functions
// that wrap FSAPI are exercised by Task 13's MenuBar integration (too thin
// to unit-test without duplicating the in-memory mock from project-root).

import { describe, it, expect } from 'vitest';
import {
  echidnaSavePath,
  characterPlyPath,
  characterManifestPath,
} from '../lib/projectFs';

describe('Echidna project path helpers', () => {
  describe('echidnaSavePath', () => {
    it('places .echidna files under tools_data/echidna_saves', () => {
      expect(echidnaSavePath('walker')).toBe('tools_data/echidna_saves/walker.echidna');
    });

    it('appends .echidna extension to the id', () => {
      expect(echidnaSavePath('walker_bot')).toBe('tools_data/echidna_saves/walker_bot.echidna');
    });
  });

  describe('characterPlyPath', () => {
    it('places PLY under assets/characters/{id}/{id}.ply', () => {
      expect(characterPlyPath('walker')).toBe('assets/characters/walker/walker.ply');
    });

    it('works for hyphenated ids', () => {
      expect(characterPlyPath('cool-guy_v2')).toBe('assets/characters/cool-guy_v2/cool-guy_v2.ply');
    });
  });

  describe('characterManifestPath', () => {
    it('places manifest under assets/characters/{id}/{id}.manifest.json', () => {
      expect(characterManifestPath('walker')).toBe('assets/characters/walker/walker.manifest.json');
    });

    it('works for hyphenated ids', () => {
      expect(characterManifestPath('cool-guy_v2')).toBe('assets/characters/cool-guy_v2/cool-guy_v2.manifest.json');
    });
  });
});
