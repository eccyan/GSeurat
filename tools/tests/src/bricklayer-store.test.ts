/**
 * Unit tests for Bricklayer store logic.
 *
 * Run: pnpm test:bricklayer-store
 */

// Re-implement minimal types and pure functions inline to avoid
// importing from the app (which has React/Three.js dependencies).

// ── Types ──

interface CollisionGridData {
  width: number;
  height: number;
  cell_size: number;
  solid: boolean[];
  elevation: number[];
  nav_zone: number[];
}

interface PlacedObjectData {
  id: string;
  ply_file: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  is_static: boolean;
}

interface StaticLight {
  position: [number, number];
  radius: number;
  height: number;
  color: [number, number, number];
  intensity: number;
}

interface NpcEntry {
  name: string;
  position: [number, number, number];
  facing: string;
}

interface PortalEntry {
  position: [number, number];
  size: [number, number];
  target_scene: string;
  spawn_position: [number, number, number];
}

interface GaussianSplatConfig {
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  render_width: number;
  render_height: number;
}

// ── Collision grid operations (mirrors store logic) ──

function initCollisionGrid(width: number, height: number, cellSize: number): CollisionGridData {
  const count = width * height;
  return {
    width,
    height,
    cell_size: cellSize,
    solid: new Array(count).fill(false),
    elevation: new Array(count).fill(0),
    nav_zone: new Array(count).fill(0),
  };
}

function toggleCellSolid(grid: CollisionGridData, x: number, z: number): CollisionGridData {
  const idx = z * grid.width + x;
  if (idx < 0 || idx >= grid.solid.length) return grid;
  const solid = [...grid.solid];
  solid[idx] = !solid[idx];
  return { ...grid, solid };
}

function setCellElevation(grid: CollisionGridData, x: number, z: number, value: number): CollisionGridData {
  const idx = z * grid.width + x;
  if (idx < 0 || idx >= grid.elevation.length) return grid;
  const elevation = [...grid.elevation];
  elevation[idx] = value;
  return { ...grid, elevation };
}

function setCellNavZone(grid: CollisionGridData, x: number, z: number, zone: number): CollisionGridData {
  const idx = z * grid.width + x;
  if (idx < 0 || idx >= grid.nav_zone.length) return grid;
  const nav_zone = [...grid.nav_zone];
  nav_zone[idx] = zone;
  return { ...grid, nav_zone };
}

// ── Scene export (mirrors lib/sceneExport.ts logic) ──

interface ExportInput {
  ambientColor: [number, number, number, number];
  collisionGridData: CollisionGridData | null;
  placedObjects: PlacedObjectData[];
  staticLights: StaticLight[];
  npcs: NpcEntry[];
  portals: PortalEntry[];
  gaussianSplat: GaussianSplatConfig | null;
}

function exportScene(input: ExportInput): Record<string, unknown> {
  const scene: Record<string, unknown> = {
    ambient_color: input.ambientColor,
  };

  if (input.collisionGridData) {
    const g = input.collisionGridData;
    scene.collision = {
      width: g.width,
      height: g.height,
      cell_size: g.cell_size,
      solid: g.solid,
      elevation: g.elevation,
      nav_zone: g.nav_zone,
    };
  }

  if (input.placedObjects.length > 0) {
    scene.placed_objects = input.placedObjects.map((obj) => ({
      id: obj.id,
      ply_file: obj.ply_file,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      is_static: obj.is_static,
    }));
  }

  if (input.staticLights.length > 0) {
    scene.static_lights = input.staticLights.map((l) => ({
      position: l.position,
      radius: l.radius,
      color: l.color,
      intensity: l.intensity,
    }));
  }

  if (input.npcs.length > 0) {
    scene.npcs = input.npcs.map((n) => ({
      name: n.name,
      position: n.position,
      facing: n.facing,
    }));
  }

  if (input.portals.length > 0) {
    scene.portals = input.portals.map((p) => ({
      position: p.position,
      size: p.size,
      target_scene: p.target_scene,
      spawn_position: p.spawn_position,
    }));
  }

  if (input.gaussianSplat) {
    scene.gaussian_splat = {
      camera: input.gaussianSplat.camera,
      render_width: input.gaussianSplat.render_width,
      render_height: input.gaussianSplat.render_height,
    };
  }

  return scene;
}

// ── Nav zone name operations ──

function addNavZoneName(names: string[], name: string): string[] {
  return [...names, name];
}

function removeNavZoneName(names: string[], index: number): string[] {
  return names.filter((_, i) => i !== index);
}

// ── File save/load (mirrors store saveProject/loadProject) ──

type VoxelKey = `${number},${number},${number}`;

function voxelKey(x: number, y: number, z: number): VoxelKey {
  return `${x},${y},${z}`;
}

interface Voxel {
  color: [number, number, number, number];
}

interface BricklayerFile {
  version: number;
  gridWidth: number;
  gridDepth: number;
  voxels: { x: number; y: number; z: number; r: number; g: number; b: number; a: number }[];
  collision: string[];
  collisionGridData?: CollisionGridData;
  nav_zone_names?: string[];
  placedObjects?: PlacedObjectData[];
}

function saveProject(
  voxels: Map<VoxelKey, Voxel>,
  gridWidth: number,
  gridDepth: number,
  collisionGridData: CollisionGridData | null,
  navZoneNames: string[],
  placedObjects: PlacedObjectData[],
): BricklayerFile {
  const voxelArr: BricklayerFile['voxels'] = [];
  for (const [key, vox] of voxels) {
    const parts = key.split(',');
    voxelArr.push({
      x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]),
      r: vox.color[0], g: vox.color[1], b: vox.color[2], a: vox.color[3],
    });
  }
  return {
    version: 1,
    gridWidth,
    gridDepth,
    voxels: voxelArr,
    collision: [],
    collisionGridData: collisionGridData ?? undefined,
    nav_zone_names: navZoneNames.length > 0 ? navZoneNames : undefined,
    placedObjects: placedObjects.length > 0 ? placedObjects : undefined,
  };
}

function loadProject(data: BricklayerFile): {
  voxels: Map<VoxelKey, Voxel>;
  gridWidth: number;
  gridDepth: number;
  collisionGridData: CollisionGridData | null;
  navZoneNames: string[];
  placedObjects: PlacedObjectData[];
} {
  const voxels = new Map<VoxelKey, Voxel>();
  for (const v of data.voxels) {
    voxels.set(voxelKey(v.x, v.y, v.z), { color: [v.r, v.g, v.b, v.a] });
  }
  return {
    voxels,
    gridWidth: data.gridWidth,
    gridDepth: data.gridDepth,
    collisionGridData: data.collisionGridData ?? null,
    navZoneNames: data.nav_zone_names ?? [],
    placedObjects: data.placedObjects ?? [],
  };
}

// ---------- Test helpers ----------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// ---------- Tests ----------

console.log('\n=== Bricklayer Store Tests ===\n');

// ═══════════════════════════════════════════════════════════════
// 1. CollisionGridData operations (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('--- CollisionGridData operations ---\n');

{
  console.log('Test 1.1: Init solid array length');
  const grid = initCollisionGrid(4, 4, 1.0);
  assert(grid.solid.length === 16, `solid array length is 16 (got ${grid.solid.length})`);
  assert(grid.solid.every((v) => v === false), 'all solid values are false');
}

{
  console.log('Test 1.2: Init elevation array length');
  const grid = initCollisionGrid(4, 4, 1.0);
  assert(grid.elevation.length === 16, `elevation array length is 16 (got ${grid.elevation.length})`);
  assert(grid.elevation.every((v) => v === 0), 'all elevation values are 0');
}

{
  console.log('Test 1.3: Init nav_zone array length');
  const grid = initCollisionGrid(4, 4, 1.0);
  assert(grid.nav_zone.length === 16, `nav_zone array length is 16 (got ${grid.nav_zone.length})`);
  assert(grid.nav_zone.every((v) => v === 0), 'all nav_zone values are 0');
}

{
  console.log('Test 1.4: Toggle solid at (1,2)');
  const grid = initCollisionGrid(4, 4, 1.0);
  const updated = toggleCellSolid(grid, 1, 2);
  const idx = 2 * 4 + 1;
  assert(updated.solid[idx] === true, `solid[${idx}] is true after toggle (got ${updated.solid[idx]})`);
}

{
  console.log('Test 1.5: Set elevation at (1,2) to 5.5');
  const grid = initCollisionGrid(4, 4, 1.0);
  const updated = setCellElevation(grid, 1, 2, 5.5);
  const idx = 2 * 4 + 1;
  assert(updated.elevation[idx] === 5.5, `elevation[${idx}] is 5.5 (got ${updated.elevation[idx]})`);
}

{
  console.log('Test 1.6: Set nav zone at (1,2) to 2');
  const grid = initCollisionGrid(4, 4, 1.0);
  const updated = setCellNavZone(grid, 1, 2, 2);
  const idx = 2 * 4 + 1;
  assert(updated.nav_zone[idx] === 2, `nav_zone[${idx}] is 2 (got ${updated.nav_zone[idx]})`);
}

{
  console.log('Test 1.7: Out-of-bounds toggle (99,99) does not crash');
  const grid = initCollisionGrid(4, 4, 1.0);
  let crashed = false;
  try {
    const updated = toggleCellSolid(grid, 99, 99);
    // Should return the grid unchanged
    assert(updated.solid.length === 16, 'solid array unchanged after OOB toggle');
    assert(updated.solid.every((v) => v === false), 'all solid values still false');
  } catch {
    crashed = true;
  }
  assert(!crashed, 'no crash on out-of-bounds toggle');
}

{
  console.log('Test 1.8: Toggle solid twice returns to false');
  const grid = initCollisionGrid(4, 4, 1.0);
  const once = toggleCellSolid(grid, 1, 2);
  const twice = toggleCellSolid(once, 1, 2);
  const idx = 2 * 4 + 1;
  assert(twice.solid[idx] === false, `solid[${idx}] is false after double toggle (got ${twice.solid[idx]})`);
}

// ═══════════════════════════════════════════════════════════════
// 2. Scene export format (10 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Scene export format ---\n');

function baseInput(): ExportInput {
  return {
    ambientColor: [0.25, 0.28, 0.45, 1],
    collisionGridData: null,
    placedObjects: [],
    staticLights: [],
    npcs: [],
    portals: [],
    gaussianSplat: null,
  };
}

{
  console.log('Test 2.1: No collision grid -> no collision key');
  const result = exportScene(baseInput());
  assert(!('collision' in result), 'no collision key in export');
}

{
  console.log('Test 2.2: With collision grid -> has width/height/cell_size/solid');
  const input = baseInput();
  input.collisionGridData = initCollisionGrid(4, 4, 1.0);
  const result = exportScene(input);
  assert('collision' in result, 'has collision key');
  const coll = result.collision as Record<string, unknown>;
  assert(coll.width === 4, `collision.width is 4 (got ${coll.width})`);
  assert(coll.height === 4, `collision.height is 4 (got ${coll.height})`);
  assert(coll.cell_size === 1.0, `collision.cell_size is 1.0 (got ${coll.cell_size})`);
  assert(Array.isArray(coll.solid), 'collision.solid is an array');
}

{
  console.log('Test 2.3: With elevation data -> has elevation array');
  const input = baseInput();
  const grid = initCollisionGrid(2, 2, 1.0);
  grid.elevation[0] = 3.0;
  input.collisionGridData = grid;
  const result = exportScene(input);
  const coll = result.collision as Record<string, unknown>;
  assert(Array.isArray(coll.elevation), 'collision has elevation array');
  assert((coll.elevation as number[])[0] === 3.0, 'elevation[0] is 3.0');
}

{
  console.log('Test 2.4: With nav_zone data -> has nav_zone array');
  const input = baseInput();
  const grid = initCollisionGrid(2, 2, 1.0);
  grid.nav_zone[1] = 5;
  input.collisionGridData = grid;
  const result = exportScene(input);
  const coll = result.collision as Record<string, unknown>;
  assert(Array.isArray(coll.nav_zone), 'collision has nav_zone array');
  assert((coll.nav_zone as number[])[1] === 5, 'nav_zone[1] is 5');
}

{
  console.log('Test 2.5: With placed objects -> has placed_objects array');
  const input = baseInput();
  input.placedObjects = [{
    id: 'obj1',
    ply_file: 'tree.ply',
    position: [1, 2, 3],
    rotation: [0, 45, 0],
    scale: 1.5,
    is_static: true,
  }];
  const result = exportScene(input);
  assert('placed_objects' in result, 'has placed_objects key');
  const objs = result.placed_objects as Record<string, unknown>[];
  assert(objs.length === 1, 'placed_objects has 1 entry');
  assert(objs[0].id === 'obj1', 'object id matches');
  assert(objs[0].ply_file === 'tree.ply', 'object ply_file matches');
  assert(objs[0].is_static === true, 'object is_static matches');
}

{
  console.log('Test 2.6: No placed objects -> no placed_objects key');
  const result = exportScene(baseInput());
  assert(!('placed_objects' in result), 'no placed_objects key');
}

{
  console.log('Test 2.7: With static light -> has static_lights');
  const input = baseInput();
  input.staticLights = [{
    position: [5, 10],
    radius: 8,
    height: 2,
    color: [1, 0.9, 0.7],
    intensity: 1.2,
  }];
  const result = exportScene(input);
  assert('static_lights' in result, 'has static_lights key');
  const lights = result.static_lights as Record<string, unknown>[];
  assert(lights.length === 1, 'static_lights has 1 entry');
  assert(lights[0].radius === 8, 'light radius matches');
  assert(lights[0].intensity === 1.2, 'light intensity matches');
}

{
  console.log('Test 2.8: With NPC -> has npcs with name/position/facing');
  const input = baseInput();
  input.npcs = [{ name: 'Guard', position: [3, 0, 5], facing: 'left' }];
  const result = exportScene(input);
  assert('npcs' in result, 'has npcs key');
  const npcs = result.npcs as Record<string, unknown>[];
  assert(npcs.length === 1, 'npcs has 1 entry');
  assert(npcs[0].name === 'Guard', 'npc name matches');
  assert(npcs[0].facing === 'left', 'npc facing matches');
}

{
  console.log('Test 2.9: With portal -> has portals with position/size/target_scene/spawn_position');
  const input = baseInput();
  input.portals = [{
    position: [10, 20],
    size: [2, 3],
    target_scene: 'dungeon',
    spawn_position: [1, 0, 1],
  }];
  const result = exportScene(input);
  assert('portals' in result, 'has portals key');
  const portals = result.portals as Record<string, unknown>[];
  assert(portals.length === 1, 'portals has 1 entry');
  assert(portals[0].target_scene === 'dungeon', 'portal target_scene matches');
}

{
  console.log('Test 2.10: Gaussian splat config -> has camera/render_width/render_height');
  const input = baseInput();
  input.gaussianSplat = {
    camera: { position: [0, 5, 10], target: [0, 0, 0], fov: 45 },
    render_width: 320,
    render_height: 240,
  };
  const result = exportScene(input);
  assert('gaussian_splat' in result, 'has gaussian_splat key');
  const gs = result.gaussian_splat as Record<string, unknown>;
  assert(gs.render_width === 320, 'render_width is 320');
  assert(gs.render_height === 240, 'render_height is 240');
  const cam = gs.camera as Record<string, unknown>;
  assert(cam.fov === 45, 'camera fov is 45');
}

// ═══════════════════════════════════════════════════════════════
// 3. Nav zone names (5 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Nav zone names ---\n');

{
  console.log('Test 3.1: Add zone name -> array grows');
  const names = addNavZoneName([], 'safe');
  assert(names.length === 1, `length is 1 (got ${names.length})`);
  assert(names[0] === 'safe', `first name is 'safe' (got '${names[0]}')`);
}

{
  console.log('Test 3.2: Remove by index -> array shrinks');
  const names = addNavZoneName(addNavZoneName([], 'safe'), 'danger');
  const after = removeNavZoneName(names, 0);
  assert(after.length === 1, `length is 1 (got ${after.length})`);
  assert(after[0] === 'danger', `remaining name is 'danger' (got '${after[0]}')`);
}

{
  console.log('Test 3.3: Multiple zones -> correct count');
  let names: string[] = [];
  names = addNavZoneName(names, 'zone_a');
  names = addNavZoneName(names, 'zone_b');
  names = addNavZoneName(names, 'zone_c');
  assert(names.length === 3, `length is 3 (got ${names.length})`);
}

{
  console.log('Test 3.4: Empty zones -> length 0');
  const names: string[] = [];
  assert(names.length === 0, `length is 0 (got ${names.length})`);
}

{
  console.log('Test 3.5: Zone name roundtrip (add, serialize, deserialize, compare)');
  let names: string[] = [];
  names = addNavZoneName(names, 'forest');
  names = addNavZoneName(names, 'river');
  const serialized = JSON.stringify(names);
  const deserialized: string[] = JSON.parse(serialized);
  assert(deserialized.length === names.length, 'deserialized length matches');
  assert(deserialized[0] === 'forest', 'deserialized[0] matches');
  assert(deserialized[1] === 'river', 'deserialized[1] matches');
}

// ═══════════════════════════════════════════════════════════════
// 4. File roundtrip (5 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- File roundtrip ---\n');

{
  console.log('Test 4.1: Save empty -> load -> save again -> identical JSON');
  const voxels = new Map<VoxelKey, Voxel>();
  const file1 = saveProject(voxels, 128, 96, null, [], []);
  const json1 = JSON.stringify(file1);
  const loaded = loadProject(JSON.parse(json1));
  const file2 = saveProject(loaded.voxels, loaded.gridWidth, loaded.gridDepth, loaded.collisionGridData, loaded.navZoneNames, loaded.placedObjects);
  const json2 = JSON.stringify(file2);
  assert(json1 === json2, 'save -> load -> save produces identical JSON');
}

{
  console.log('Test 4.2: Save with 3 voxels -> load -> voxel count = 3');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [255, 0, 0, 255] });
  voxels.set(voxelKey(1, 0, 0), { color: [0, 255, 0, 255] });
  voxels.set(voxelKey(2, 0, 0), { color: [0, 0, 255, 255] });
  const file = saveProject(voxels, 32, 32, null, [], []);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  assert(loaded.voxels.size === 3, `voxel count is 3 (got ${loaded.voxels.size})`);
}

{
  console.log('Test 4.3: Save with collision grid -> load -> dimensions match');
  const grid = initCollisionGrid(8, 6, 2.0);
  grid.solid[5] = true;
  grid.elevation[3] = 1.5;
  const file = saveProject(new Map(), 64, 48, grid, [], []);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  assert(loaded.collisionGridData !== null, 'collision grid loaded');
  assert(loaded.collisionGridData!.width === 8, `width is 8 (got ${loaded.collisionGridData!.width})`);
  assert(loaded.collisionGridData!.height === 6, `height is 6 (got ${loaded.collisionGridData!.height})`);
  assert(loaded.collisionGridData!.cell_size === 2.0, `cell_size is 2.0 (got ${loaded.collisionGridData!.cell_size})`);
  assert(loaded.collisionGridData!.solid[5] === true, 'solid[5] preserved');
  assert(loaded.collisionGridData!.elevation[3] === 1.5, 'elevation[3] preserved');
}

{
  console.log('Test 4.4: Save with 2 placed objects -> load -> count = 2');
  const objs: PlacedObjectData[] = [
    { id: 'a', ply_file: 'tree.ply', position: [1, 2, 3], rotation: [0, 0, 0], scale: 1, is_static: true },
    { id: 'b', ply_file: 'rock.ply', position: [4, 5, 6], rotation: [0, 90, 0], scale: 2, is_static: false },
  ];
  const file = saveProject(new Map(), 32, 32, null, [], objs);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  assert(loaded.placedObjects.length === 2, `placed object count is 2 (got ${loaded.placedObjects.length})`);
  assert(loaded.placedObjects[0].ply_file === 'tree.ply', 'first object ply_file matches');
  assert(loaded.placedObjects[1].ply_file === 'rock.ply', 'second object ply_file matches');
}

{
  console.log('Test 4.5: Save with nav zone names -> load -> names match');
  const names = ['forest', 'river', 'mountain'];
  const file = saveProject(new Map(), 32, 32, null, names, []);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  assert(loaded.navZoneNames.length === 3, `nav zone name count is 3 (got ${loaded.navZoneNames.length})`);
  assert(loaded.navZoneNames[0] === 'forest', 'first name matches');
  assert(loaded.navZoneNames[1] === 'river', 'second name matches');
  assert(loaded.navZoneNames[2] === 'mountain', 'third name matches');
}

// ═══════════════════════════════════════════════════════════════
// 5. Box fill collision (4 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Box fill collision ---\n');

function setCellSolid(grid: CollisionGridData, x: number, z: number, value: boolean): CollisionGridData {
  const idx = z * grid.width + x;
  if (idx < 0 || idx >= grid.solid.length) return grid;
  const solid = [...grid.solid];
  solid[idx] = value;
  return { ...grid, solid };
}

function boxFillSolid(grid: CollisionGridData, sx: number, sz: number, ex: number, ez: number): CollisionGridData {
  let result = grid;
  const minX = Math.min(sx, ex);
  const maxX = Math.max(sx, ex);
  const minZ = Math.min(sz, ez);
  const maxZ = Math.max(sz, ez);
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      result = setCellSolid(result, x, z, true);
    }
  }
  return result;
}

{
  console.log('Test 5.1: Box fill 2x2 -> 4 cells solid');
  const grid = initCollisionGrid(8, 8, 1.0);
  const filled = boxFillSolid(grid, 1, 1, 2, 2);
  let solidCount = 0;
  for (let i = 0; i < filled.solid.length; i++) {
    if (filled.solid[i]) solidCount++;
  }
  assert(solidCount === 4, `solid count is 4 (got ${solidCount})`);
}

{
  console.log('Test 5.2: Box fill single cell -> 1 cell solid');
  const grid = initCollisionGrid(8, 8, 1.0);
  const filled = boxFillSolid(grid, 3, 3, 3, 3);
  let solidCount = 0;
  for (let i = 0; i < filled.solid.length; i++) {
    if (filled.solid[i]) solidCount++;
  }
  assert(solidCount === 1, `solid count is 1 (got ${solidCount})`);
}

{
  console.log('Test 5.3: Box fill reversed coords -> same result');
  const grid = initCollisionGrid(8, 8, 1.0);
  const filled1 = boxFillSolid(grid, 0, 0, 3, 3);
  const filled2 = boxFillSolid(grid, 3, 3, 0, 0);
  let count1 = 0, count2 = 0;
  for (let i = 0; i < filled1.solid.length; i++) {
    if (filled1.solid[i]) count1++;
    if (filled2.solid[i]) count2++;
  }
  assert(count1 === count2, `forward and reverse fill same count (${count1} vs ${count2})`);
  assert(count1 === 16, `solid count is 16 (got ${count1})`);
}

{
  console.log('Test 5.4: setCellSolid explicit -> sets value');
  const grid = initCollisionGrid(4, 4, 1.0);
  const updated = setCellSolid(grid, 2, 3, true);
  const idx = 3 * 4 + 2;
  assert(updated.solid[idx] === true, `solid[${idx}] is true (got ${updated.solid[idx]})`);
  const reverted = setCellSolid(updated, 2, 3, false);
  assert(reverted.solid[idx] === false, `solid[${idx}] is false after revert (got ${reverted.solid[idx]})`);
}

// ═══════════════════════════════════════════════════════════════
// 6. Auto-generate collision from voxels (4 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Auto-generate collision ---\n');

function autoGenerateCollision(
  voxelEntries: [number, number, number][],
  grid: CollisionGridData,
  slopeThreshold: number,
): CollisionGridData {
  // Find highest Y per XZ cell
  const highestY = new Map<string, number>();
  for (const [x, y, z] of voxelEntries) {
    const cellX = Math.round(x / grid.cell_size);
    const cellZ = Math.round(z / grid.cell_size);
    if (cellX < 0 || cellX >= grid.width || cellZ < 0 || cellZ >= grid.height) continue;
    const ck = `${cellX},${cellZ}`;
    const prev = highestY.get(ck);
    if (prev === undefined || y > prev) highestY.set(ck, y);
  }

  const solid = [...grid.solid];
  const elevation = [...grid.elevation];

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const idx = z * grid.width + x;
      const ck = `${x},${z}`;
      const h = highestY.get(ck);
      if (h === undefined) {
        solid[idx] = true;
        elevation[idx] = 0;
      } else {
        elevation[idx] = h;
        let maxSlope = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nx >= grid.width || nz < 0 || nz >= grid.height) continue;
          const nh = highestY.get(`${nx},${nz}`);
          if (nh !== undefined) {
            maxSlope = Math.max(maxSlope, Math.abs(h - nh));
          }
        }
        solid[idx] = maxSlope > slopeThreshold;
      }
    }
  }

  return { ...grid, solid, elevation };
}

{
  console.log('Test 6.1: Empty voxels -> all solid');
  const grid = initCollisionGrid(4, 4, 1.0);
  const result = autoGenerateCollision([], grid, 5.0);
  assert(result.solid.every((v) => v === true), 'all cells solid when no voxels');
}

{
  console.log('Test 6.2: Flat voxels -> no solid (flat = no slope)');
  const grid = initCollisionGrid(4, 4, 1.0);
  const voxels: [number, number, number][] = [];
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      voxels.push([x, 0, z]);
    }
  }
  const result = autoGenerateCollision(voxels, grid, 5.0);
  assert(result.solid.every((v) => v === false), 'no cells solid for flat terrain');
  assert(result.elevation.every((v) => v === 0), 'all elevations are 0');
}

{
  console.log('Test 6.3: Steep slope -> solid');
  const grid = initCollisionGrid(4, 4, 1.0);
  const voxels: [number, number, number][] = [
    [0, 0, 0], [1, 10, 0], [2, 0, 0], [3, 0, 0],
    [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1],
    [0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2],
    [0, 0, 3], [1, 0, 3], [2, 0, 3], [3, 0, 3],
  ];
  const result = autoGenerateCollision(voxels, grid, 5.0);
  // Cell (1,0) has height 10, neighbors have 0 -> slope = 10 > 5 -> solid
  const idx10 = 0 * 4 + 1;
  assert(result.solid[idx10] === true, `cell (1,0) is solid due to steep slope (got ${result.solid[idx10]})`);
  // Cell (0,0) neighbors cell (1,0) with slope 10 > 5 -> also solid
  const idx00 = 0 * 4 + 0;
  assert(result.solid[idx00] === true, `cell (0,0) is solid due to neighbor slope (got ${result.solid[idx00]})`);
}

{
  console.log('Test 6.4: Elevation set correctly from highest voxel');
  const grid = initCollisionGrid(2, 2, 1.0);
  const voxels: [number, number, number][] = [
    [0, 0, 0], [0, 3, 0], [0, 5, 0], // Multiple Y at same XZ -> highest is 5
    [1, 2, 0],
    [0, 1, 1],
    [1, 4, 1],
  ];
  const result = autoGenerateCollision(voxels, grid, 100); // high threshold = no solid from slope
  assert(result.elevation[0] === 5, `elevation at (0,0) is 5 (got ${result.elevation[0]})`);
  assert(result.elevation[1] === 2, `elevation at (1,0) is 2 (got ${result.elevation[1]})`);
  assert(result.elevation[2] === 1, `elevation at (0,1) is 1 (got ${result.elevation[2]})`);
  assert(result.elevation[3] === 4, `elevation at (1,1) is 4 (got ${result.elevation[3]})`);
}

// ═══════════════════════════════════════════════════════════════
// 7. Palette operations (5 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Palette operations ---\n');

type RGBA = [number, number, number, number];

{
  console.log('Test 7.1: Add palette -> palette count increases');
  const palettes: RGBA[][] = [];
  const next = [...palettes, []];
  assert(next.length === 1, `palette count is 1 (got ${next.length})`);
}

{
  console.log('Test 7.2: Add color to palette');
  const palettes: RGBA[][] = [[]];
  const color: RGBA = [255, 0, 0, 255];
  palettes[0] = [...palettes[0], color];
  assert(palettes[0].length === 1, `palette has 1 color (got ${palettes[0].length})`);
  assert(palettes[0][0][0] === 255, `red is 255 (got ${palettes[0][0][0]})`);
}

{
  console.log('Test 7.3: Remove palette -> palette count decreases');
  const palettes: RGBA[][] = [[], [[10, 20, 30, 255]]];
  const filtered = palettes.filter((_, i) => i !== 0);
  assert(filtered.length === 1, `palette count is 1 (got ${filtered.length})`);
  assert(filtered[0].length === 1, `remaining palette has 1 color`);
}

{
  console.log('Test 7.4: Extract colors from histogram');
  // Simulate color extraction
  function extractColors(pixels: [number, number, number][]): RGBA[] {
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (const [r, g, b] of pixels) {
      const rq = (r >> 4) & 0xf;
      const gq = (g >> 4) & 0xf;
      const bq = (b >> 4) & 0xf;
      const key = (rq << 8) | (gq << 4) | bq;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
        existing.r += r;
        existing.g += g;
        existing.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }
    const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
    return sorted.slice(0, 20).map((b) => [
      Math.round(b.r / b.count),
      Math.round(b.g / b.count),
      Math.round(b.b / b.count),
      255,
    ]);
  }

  const pixels: [number, number, number][] = [];
  for (let i = 0; i < 100; i++) pixels.push([255, 0, 0]);
  for (let i = 0; i < 50; i++) pixels.push([0, 255, 0]);
  for (let i = 0; i < 25; i++) pixels.push([0, 0, 255]);

  const colors = extractColors(pixels);
  assert(colors.length === 3, `extracted 3 colors (got ${colors.length})`);
  assert(colors[0][0] === 255 && colors[0][1] === 0, 'most frequent color is red');
  assert(colors[1][1] === 255 && colors[1][0] === 0, 'second most frequent is green');
}

{
  console.log('Test 7.5: Extract colors limits to 20');
  function extractColors(pixels: [number, number, number][]): RGBA[] {
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (const [r, g, b] of pixels) {
      const rq = (r >> 4) & 0xf;
      const gq = (g >> 4) & 0xf;
      const bq = (b >> 4) & 0xf;
      const key = (rq << 8) | (gq << 4) | bq;
      const existing = buckets.get(key);
      if (existing) {
        existing.count++;
        existing.r += r;
        existing.g += g;
        existing.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }
    const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
    return sorted.slice(0, 20).map((b) => [
      Math.round(b.r / b.count),
      Math.round(b.g / b.count),
      Math.round(b.b / b.count),
      255,
    ]);
  }

  // Generate 30 distinct 4-bit-quantized colors
  const pixels: [number, number, number][] = [];
  for (let i = 0; i < 30; i++) {
    const r = (i * 17) % 256;
    const g = (i * 37) % 256;
    const b = (i * 53) % 256;
    pixels.push([r, g, b]);
  }
  const colors = extractColors(pixels);
  assert(colors.length <= 20, `extracted at most 20 colors (got ${colors.length})`);
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
