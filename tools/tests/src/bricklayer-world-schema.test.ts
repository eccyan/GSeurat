import assert from 'node:assert/strict';
import {
  createEmptyManifest,
  chunkGridKey,
  type WorldManifest,
  type WorldInstance,
  type WorldPortal,
} from '@gseurat/project-root';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

console.log('WorldManifest Schema Tests');
console.log('─'.repeat(40));

test('createEmptyManifest includes instances and portals arrays', () => {
  const m = createEmptyManifest();
  assert.ok(Array.isArray(m.instances), 'instances should be an array');
  assert.ok(Array.isArray(m.portals), 'portals should be an array');
  assert.equal(m.instances.length, 0);
  assert.equal(m.portals.length, 0);
});

test('createEmptyManifest preserves existing fields', () => {
  const m = createEmptyManifest();
  assert.equal(m.version, 1);
  assert.deepEqual(m.grid_cell_size, [64, 32, 64]);
  assert.ok(Array.isArray(m.chunks));
  assert.ok(Array.isArray(m.streaming_volumes));
});

test('WorldInstance has required fields', () => {
  const inst: WorldInstance = {
    id: 'dungeon_01',
    display_name: 'Test Dungeon',
    scene_file: 'assets/scenes/dungeon.json',
  };
  assert.equal(inst.id, 'dungeon_01');
  assert.equal(inst.display_name, 'Test Dungeon');
  assert.equal(inst.scene_file, 'assets/scenes/dungeon.json');
});

test('WorldPortal has required fields', () => {
  const portal: WorldPortal = {
    id: 'portal_1',
    display_name: 'Dungeon Entrance',
    position: [50, 0, 30],
    half_extents: [1, 2, 0.5],
    source_chunk: '0,0,0',
    target_instance: 'dungeon_01',
    target_spawn: [0, 0, 0],
  };
  assert.equal(portal.id, 'portal_1');
  assert.equal(portal.source_chunk, '0,0,0');
  assert.equal(portal.target_instance, 'dungeon_01');
  assert.deepEqual(portal.position, [50, 0, 30]);
  assert.deepEqual(portal.half_extents, [1, 2, 0.5]);
  assert.deepEqual(portal.target_spawn, [0, 0, 0]);
});

test('WorldManifest with instances and portals round-trips through JSON', () => {
  const manifest: WorldManifest = {
    version: 1,
    grid_cell_size: [192, 64, 192],
    chunks: [{ grid: [0, 0, 0], ply_file: 'assets/maps/island.ply', scene_file: 'assets/scenes/island.json' }],
    instances: [
      { id: 'dungeon_01', display_name: 'Tavern Interior', scene_file: 'assets/scenes/tavern.json' },
      { id: 'cave_02', display_name: 'Crystal Cave', scene_file: 'assets/scenes/cave.json' },
    ],
    streaming_volumes: [
      { id: 'sv_1', shape: 'sphere', position: [100, 0, 100], radius: 50, preload_target_ids: ['0,0,-1'] },
    ],
    portals: [
      {
        id: 'portal_1',
        display_name: 'Tavern Door',
        position: [50, 0, 30],
        half_extents: [1, 2, 0.5],
        source_chunk: '0,0,0',
        target_instance: 'dungeon_01',
        target_spawn: [5, 0, 5],
      },
    ],
  };

  const json = JSON.stringify(manifest);
  const parsed = JSON.parse(json) as WorldManifest;

  assert.equal(parsed.instances.length, 2);
  assert.equal(parsed.instances[0].id, 'dungeon_01');
  assert.equal(parsed.instances[1].display_name, 'Crystal Cave');
  assert.equal(parsed.portals.length, 1);
  assert.equal(parsed.portals[0].target_instance, 'dungeon_01');
  assert.deepEqual(parsed.portals[0].target_spawn, [5, 0, 5]);
});

test('Empty manifest round-trips correctly', () => {
  const m = createEmptyManifest();
  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as WorldManifest;
  assert.deepEqual(parsed, m);
});

test('source_chunk matches chunkGridKey format', () => {
  const key = chunkGridKey([1, 0, -2]);
  const portal: WorldPortal = {
    id: 'p1',
    display_name: 'Test',
    position: [0, 0, 0],
    half_extents: [1, 1, 1],
    source_chunk: key,
    target_instance: 'inst_1',
    target_spawn: [0, 0, 0],
  };
  assert.equal(portal.source_chunk, '1,0,-2');
});

console.log('─'.repeat(40));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
