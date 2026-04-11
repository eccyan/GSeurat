// Unit tests for pure path builders. The async save/load/export functions
// that wrap FSAPI are exercised by Task 13's MenuBar integration (too thin
// to unit-test without duplicating the in-memory mock from project-root).

import { describe, it, expect } from 'vitest';
import { testing } from '@gseurat/project-root';
import { listEchidnaProjects, deleteEchidnaProject, renameEchidnaProject, duplicateEchidnaProject } from '../lib/projectFs';
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

describe('deleteEchidnaProject', () => {
  it('removes the .echidna source and leaves assets/characters/{id}/* alone', async () => {
    const root = testing.makeRoot();

    // Seed: .echidna source + exported engine files
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const src = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await src.createWritable();
    await w.write('{}');
    await w.close();

    const assets = await root.getDirectoryHandle('assets', { create: true });
    const chars = await assets.getDirectoryHandle('characters', { create: true });
    const walker = await chars.getDirectoryHandle('walker', { create: true });
    const ply = await walker.getFileHandle('walker.ply', { create: true });
    const wPly = await ply.createWritable();
    await wPly.write('fake ply bytes');
    await wPly.close();

    await deleteEchidnaProject(root as any, 'walker');

    // Source file is gone
    await expect(saves.getFileHandle('walker.echidna')).rejects.toThrow(/NotFoundError/);
    // Engine files are STILL THERE
    await walker.getFileHandle('walker.ply'); // does not throw
  });

  it('throws NotFoundError when the source file does not exist', async () => {
    const root = testing.makeRoot();
    await expect(deleteEchidnaProject(root as any, 'ghost')).rejects.toThrow(/NotFoundError/);
  });
});

describe('renameEchidnaProject', () => {
  it('updates characterName in the file without changing the filename', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [], parts: [], poses: {},
    }));
    await w.close();

    await renameEchidnaProject(root as any, 'walker', 'Walker v2');

    const re = await saves.getFileHandle('walker.echidna');   // same filename
    const reFile = await re.getFile();
    const parsed = JSON.parse(await reFile.text());
    expect(parsed.id).toBe('walker');                          // same id
    expect(parsed.characterName).toBe('Walker v2');            // new display name
  });
});

describe('duplicateEchidnaProject', () => {
  it('creates a new file with updated id and characterName', async () => {
    const root = testing.makeRoot();
    const td = await root.getDirectoryHandle('tools_data', { create: true });
    const saves = await td.getDirectoryHandle('echidna_saves', { create: true });
    const fh = await saves.getFileHandle('walker.echidna', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      version: 3, id: 'walker', characterName: 'Walker Bot',
      voxels: [{ key: '0,0,0', color: [255, 0, 0, 255] }],
      parts: [], poses: {},
    }));
    await w.close();

    await duplicateEchidnaProject(root as any, 'walker', 'walker_2', 'Copy of Walker Bot');

    const newFh = await saves.getFileHandle('walker_2.echidna');
    const newFile = await newFh.getFile();
    const parsed = JSON.parse(await newFile.text());
    expect(parsed.id).toBe('walker_2');
    expect(parsed.characterName).toBe('Copy of Walker Bot');
    expect(parsed.voxels).toHaveLength(1);                 // content preserved

    // Original still exists
    await saves.getFileHandle('walker.echidna');
  });
});
