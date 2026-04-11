// Unit tests for pure path builders. The async save/load/export functions
// that wrap FSAPI are exercised by Task 13's MenuBar integration (too thin
// to unit-test without duplicating the in-memory mock from project-root).

import { describe, it, expect } from 'vitest';
import { testing } from '@gseurat/project-root';
import { listEchidnaProjects } from '../lib/projectFs';
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

describe('listEchidnaProjects', () => {
  it('returns [] for an empty project', async () => {
    const root = testing.makeRoot();
    const entries = await listEchidnaProjects(root as any);
    expect(entries).toEqual([]);
  });

  it('lists only .echidna files from tools_data/echidna_saves', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });

    // Write 3 .echidna files + 1 unrelated file
    for (const [name, body] of [
      ['walker.echidna', JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker Bot', voxels: [], parts: [], poses: {} })],
      ['archer.echidna', JSON.stringify({ version: 3, id: 'archer', characterName: 'Archer', voxels: [], parts: [], poses: {} })],
      ['mage.echidna',   JSON.stringify({ version: 3, id: 'mage',   characterName: 'Mage',   voxels: [], parts: [], poses: {} })],
      ['junk.txt',       'not an echidna file'],
    ] as const) {
      const fh = await saves.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(body);
      await w.close();
    }

    const entries = await listEchidnaProjects(root as any);
    expect(entries.map((e) => e.id).sort()).toEqual(['archer', 'mage', 'walker']);
    expect(entries.find((e) => e.id === 'walker')?.name).toBe('Walker Bot');
  });

  it('returns [] when tools_data/echidna_saves does not exist', async () => {
    const root = testing.makeRoot();
    // No subdirs created
    const entries = await listEchidnaProjects(root as any);
    expect(entries).toEqual([]);
  });

  it('skips subdirectories in tools_data/echidna_saves', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });

    // Add a .echidna file
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 3, id: 'walker', characterName: 'Walker', voxels: [], parts: [], poses: {} }));
    await w.close();

    // Add a sibling subdirectory (e.g., a backup folder)
    await saves.getDirectoryHandle('backup', { create: true });

    const entries = await listEchidnaProjects(root as any);
    expect(entries.map((e) => e.id)).toEqual(['walker']);
  });

  it('skips unreadable files gracefully', async () => {
    const root = testing.makeRoot();
    const toolsData = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await toolsData.getDirectoryHandle('echidna_saves', { create: true });

    const good = await saves.getFileHandle('good.echidna', { create: true });
    const wGood = await good.createWritable();
    await wGood.write(JSON.stringify({ version: 3, id: 'good', characterName: 'Good' }));
    await wGood.close();

    const bad = await saves.getFileHandle('bad.echidna', { create: true });
    const wBad = await bad.createWritable();
    await wBad.write('not json at all');
    await wBad.close();

    const entries = await listEchidnaProjects(root as any);
    // The bad file is skipped; good is still listed
    expect(entries.map((e) => e.id)).toEqual(['good']);
  });
});
