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

interface ColorPalette {
  name: string;
  colors: [number, number, number, number][];
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

function setCellSolid(grid: CollisionGridData, x: number, z: number, val: boolean): CollisionGridData {
  const idx = z * grid.width + x;
  if (idx < 0 || idx >= grid.solid.length) return grid;
  const solid = [...grid.solid];
  solid[idx] = val;
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

function boxFillSolid(grid: CollisionGridData, x1: number, z1: number, x2: number, z2: number): CollisionGridData {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);
  let result = grid;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      result = setCellSolid(result, x, z, true);
    }
  }
  return result;
}

function autoGenerateCollision(
  grid: CollisionGridData,
  heightMap: Map<string, number>,
  slopeThreshold: number,
): CollisionGridData {
  const solid = [...grid.solid];
  const elevation = [...grid.elevation];

  for (let cz = 0; cz < grid.height; cz++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const idx = cz * grid.width + cx;
      const h = heightMap.get(`${cx},${cz}`) ?? 0;
      elevation[idx] = h;

      let maxSlope = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nh = heightMap.get(`${cx + dx},${cz + dz}`) ?? 0;
        maxSlope = Math.max(maxSlope, Math.abs(h - nh));
      }
      solid[idx] = maxSlope > slopeThreshold;
    }
  }

  return { ...grid, solid, elevation };
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

// ── Palette operations (mirrors store logic) ──

function addPalette(palettes: ColorPalette[], name: string): ColorPalette[] {
  return [...palettes, { name, colors: [] }];
}

function removePalette(palettes: ColorPalette[], index: number): ColorPalette[] {
  const result = palettes.filter((_, i) => i !== index);
  if (result.length === 0) return [{ name: 'Default', colors: [] }];
  return result;
}

function addColorToPalette(palettes: ColorPalette[], paletteIndex: number, color: [number, number, number, number]): ColorPalette[] {
  const result = [...palettes];
  if (!result[paletteIndex]) return result;
  result[paletteIndex] = {
    ...result[paletteIndex],
    colors: [...result[paletteIndex].colors, color],
  };
  return result;
}

function setPaletteColor(palettes: ColorPalette[], paletteIndex: number, colorIndex: number, color: [number, number, number, number]): ColorPalette[] {
  const result = [...palettes];
  if (!result[paletteIndex]) return result;
  const colors = [...result[paletteIndex].colors];
  colors[colorIndex] = color;
  result[paletteIndex] = { ...result[paletteIndex], colors };
  return result;
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
// 1. CollisionGridData operations (10 tests)
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

{
  console.log('Test 1.9: setCellSolid explicitly sets value');
  const grid = initCollisionGrid(4, 4, 1.0);
  const set1 = setCellSolid(grid, 2, 1, true);
  const idx = 1 * 4 + 2;
  assert(set1.solid[idx] === true, `solid[${idx}] is true after setCellSolid(true)`);
  const set2 = setCellSolid(set1, 2, 1, false);
  assert(set2.solid[idx] === false, `solid[${idx}] is false after setCellSolid(false)`);
}

{
  console.log('Test 1.10: setCellSolid out-of-bounds returns grid unchanged');
  const grid = initCollisionGrid(4, 4, 1.0);
  const updated = setCellSolid(grid, 99, 99, true);
  assert(updated.solid.every((v) => v === false), 'no cells changed on OOB setCellSolid');
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
// 5. Box fill (6 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Box fill ---\n');

{
  console.log('Test 5.1: Box fill 2x2 area');
  const grid = initCollisionGrid(8, 8, 1.0);
  const filled = boxFillSolid(grid, 1, 1, 2, 2);
  assert(filled.solid[1 * 8 + 1] === true, '(1,1) is solid');
  assert(filled.solid[1 * 8 + 2] === true, '(2,1) is solid');
  assert(filled.solid[2 * 8 + 1] === true, '(1,2) is solid');
  assert(filled.solid[2 * 8 + 2] === true, '(2,2) is solid');
  assert(filled.solid[0 * 8 + 0] === false, '(0,0) is still walkable');
}

{
  console.log('Test 5.2: Box fill with reversed coordinates');
  const grid = initCollisionGrid(8, 8, 1.0);
  const filled = boxFillSolid(grid, 3, 3, 1, 1);
  let count = 0;
  for (const s of filled.solid) if (s) count++;
  assert(count === 9, `3x3 box = 9 solid cells (got ${count})`);
}

{
  console.log('Test 5.3: Box fill single cell');
  const grid = initCollisionGrid(4, 4, 1.0);
  const filled = boxFillSolid(grid, 2, 2, 2, 2);
  let count = 0;
  for (const s of filled.solid) if (s) count++;
  assert(count === 1, `single cell box fill = 1 solid (got ${count})`);
}

{
  console.log('Test 5.4: Box fill full row');
  const grid = initCollisionGrid(4, 4, 1.0);
  const filled = boxFillSolid(grid, 0, 0, 3, 0);
  assert(filled.solid[0] === true, '(0,0) solid');
  assert(filled.solid[1] === true, '(1,0) solid');
  assert(filled.solid[2] === true, '(2,0) solid');
  assert(filled.solid[3] === true, '(3,0) solid');
  assert(filled.solid[4] === false, '(0,1) walkable');
}

{
  console.log('Test 5.5: Box fill full column');
  const grid = initCollisionGrid(4, 4, 1.0);
  const filled = boxFillSolid(grid, 0, 0, 0, 3);
  assert(filled.solid[0] === true, '(0,0) solid');
  assert(filled.solid[4] === true, '(0,1) solid');
  assert(filled.solid[8] === true, '(0,2) solid');
  assert(filled.solid[12] === true, '(0,3) solid');
  assert(filled.solid[1] === false, '(1,0) walkable');
}

{
  console.log('Test 5.6: Box fill does not affect already-solid cells');
  const grid = initCollisionGrid(4, 4, 1.0);
  const preFilled = setCellSolid(grid, 1, 1, true);
  const filled = boxFillSolid(preFilled, 0, 0, 2, 2);
  let count = 0;
  for (const s of filled.solid) if (s) count++;
  assert(count === 9, `3x3 box fill = 9 solid (got ${count})`);
  assert(filled.solid[1 * 4 + 1] === true, '(1,1) still solid');
}

// ═══════════════════════════════════════════════════════════════
// 6. Auto-generate collision (5 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Auto-generate collision ---\n');

{
  console.log('Test 6.1: Flat terrain -> interior cells not solid');
  const grid = initCollisionGrid(4, 4, 1.0);
  const heightMap = new Map<string, number>();
  // Fill including neighbors outside grid to avoid edge effects
  for (let z = -1; z <= 4; z++) for (let x = -1; x <= 4; x++) heightMap.set(`${x},${z}`, 5);
  const result = autoGenerateCollision(grid, heightMap, 1.0);
  // Interior cells (1,1), (2,2) should not be solid since all neighbors have same height
  assert(result.solid[1 * 4 + 1] === false, 'interior cell (1,1) is not solid');
  assert(result.solid[2 * 4 + 2] === false, 'interior cell (2,2) is not solid');
}

{
  console.log('Test 6.2: Cliff face -> solid cells');
  const grid = initCollisionGrid(4, 4, 1.0);
  const heightMap = new Map<string, number>();
  for (let z = 0; z < 4; z++) {
    for (let x = 0; x < 4; x++) {
      heightMap.set(`${x},${z}`, x >= 2 ? 10 : 0);
    }
  }
  const result = autoGenerateCollision(grid, heightMap, 1.0);
  // Cells at x=1 and x=2 should be solid (adjacent to cliff)
  assert(result.solid[0 * 4 + 1] === true, '(1,0) is solid at cliff edge');
  assert(result.solid[0 * 4 + 2] === true, '(2,0) is solid at cliff top');
}

{
  console.log('Test 6.3: Elevation values are set from height map');
  const grid = initCollisionGrid(4, 4, 1.0);
  const heightMap = new Map<string, number>();
  heightMap.set('2,1', 7.5);
  const result = autoGenerateCollision(grid, heightMap, 100);
  const idx = 1 * 4 + 2;
  assert(result.elevation[idx] === 7.5, `elevation at (2,1) is 7.5 (got ${result.elevation[idx]})`);
}

{
  console.log('Test 6.4: High threshold -> no solid');
  const grid = initCollisionGrid(4, 4, 1.0);
  const heightMap = new Map<string, number>();
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) heightMap.set(`${x},${z}`, x);
  const result = autoGenerateCollision(grid, heightMap, 10.0);
  assert(result.solid.every((v) => v === false), 'high threshold = no solid cells');
}

{
  console.log('Test 6.5: Zero threshold -> all cells with any neighbor difference are solid');
  const grid = initCollisionGrid(3, 1, 1.0);
  const heightMap = new Map<string, number>();
  heightMap.set('0,0', 0);
  heightMap.set('1,0', 1);
  heightMap.set('2,0', 1);
  const result = autoGenerateCollision(grid, heightMap, 0);
  // Cell (0,0) neighbors (1,0) with diff 1 > 0 -> solid
  assert(result.solid[0] === true, '(0,0) is solid with zero threshold');
  // Cell (1,0) neighbors (0,0) with diff 1 > 0 -> solid
  assert(result.solid[1] === true, '(1,0) is solid with zero threshold');
}

// ═══════════════════════════════════════════════════════════════
// 7. Color palettes (10 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Color palettes ---\n');

{
  console.log('Test 7.1: Add palette');
  const palettes = addPalette([], 'Nature');
  assert(palettes.length === 1, `palette count is 1 (got ${palettes.length})`);
  assert(palettes[0].name === 'Nature', 'palette name matches');
  assert(palettes[0].colors.length === 0, 'palette starts empty');
}

{
  console.log('Test 7.2: Add color to palette');
  let palettes: ColorPalette[] = [{ name: 'P1', colors: [] }];
  palettes = addColorToPalette(palettes, 0, [255, 0, 0, 255]);
  assert(palettes[0].colors.length === 1, 'color added');
  assert(palettes[0].colors[0][0] === 255, 'red channel is 255');
}

{
  console.log('Test 7.3: Set palette color');
  let palettes: ColorPalette[] = [{ name: 'P1', colors: [[255, 0, 0, 255]] }];
  palettes = setPaletteColor(palettes, 0, 0, [0, 255, 0, 255]);
  assert(palettes[0].colors[0][1] === 255, 'green channel is 255 after set');
}

{
  console.log('Test 7.4: Remove palette reverts to default');
  let palettes: ColorPalette[] = [{ name: 'P1', colors: [] }];
  palettes = removePalette(palettes, 0);
  assert(palettes.length === 1, 'at least one palette remains');
  assert(palettes[0].name === 'Default', 'fallback palette is named Default');
}

{
  console.log('Test 7.5: Multiple palettes maintain independence');
  let palettes = addPalette([], 'A');
  palettes = addPalette(palettes, 'B');
  palettes = addColorToPalette(palettes, 0, [1, 2, 3, 4]);
  palettes = addColorToPalette(palettes, 1, [5, 6, 7, 8]);
  assert(palettes[0].colors.length === 1, 'palette A has 1 color');
  assert(palettes[1].colors.length === 1, 'palette B has 1 color');
  assert(palettes[0].colors[0][0] === 1, 'palette A color[0] = 1');
  assert(palettes[1].colors[0][0] === 5, 'palette B color[0] = 5');
}

{
  console.log('Test 7.6: Remove palette by index preserves others');
  let palettes = addPalette([], 'A');
  palettes = addPalette(palettes, 'B');
  palettes = addPalette(palettes, 'C');
  palettes = removePalette(palettes, 1);
  assert(palettes.length === 2, '2 palettes remain');
  assert(palettes[0].name === 'A', 'first is A');
  assert(palettes[1].name === 'C', 'second is C');
}

{
  console.log('Test 7.7: Add multiple colors to same palette');
  let palettes: ColorPalette[] = [{ name: 'P', colors: [] }];
  palettes = addColorToPalette(palettes, 0, [10, 20, 30, 255]);
  palettes = addColorToPalette(palettes, 0, [40, 50, 60, 255]);
  palettes = addColorToPalette(palettes, 0, [70, 80, 90, 255]);
  assert(palettes[0].colors.length === 3, '3 colors in palette');
}

{
  console.log('Test 7.8: setPaletteColor on invalid index is safe');
  let palettes: ColorPalette[] = [{ name: 'P', colors: [[1, 2, 3, 4]] }];
  palettes = setPaletteColor(palettes, 5, 0, [9, 9, 9, 9]);
  assert(palettes.length === 1, 'no crash on invalid palette index');
  assert(palettes[0].colors[0][0] === 1, 'original color unchanged');
}

{
  console.log('Test 7.9: addColorToPalette on invalid index is safe');
  let palettes: ColorPalette[] = [{ name: 'P', colors: [] }];
  palettes = addColorToPalette(palettes, 99, [1, 2, 3, 4]);
  assert(palettes[0].colors.length === 0, 'no color added to invalid index');
}

{
  console.log('Test 7.10: Palette serialization roundtrip');
  let palettes: ColorPalette[] = [{ name: 'Test', colors: [[10, 20, 30, 255], [40, 50, 60, 128]] }];
  const json = JSON.stringify(palettes);
  const restored: ColorPalette[] = JSON.parse(json);
  assert(restored[0].name === 'Test', 'name preserved');
  assert(restored[0].colors.length === 2, '2 colors preserved');
  assert(restored[0].colors[1][3] === 128, 'alpha preserved');
}

// ═══════════════════════════════════════════════════════════════
// 8. Large grid and edge cases (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Large grid and edge cases ---\n');

{
  console.log('Test 8.1: Large grid (128x128) initializes correctly');
  const grid = initCollisionGrid(128, 128, 0.5);
  assert(grid.solid.length === 128 * 128, `solid length is ${128 * 128} (got ${grid.solid.length})`);
  assert(grid.cell_size === 0.5, 'cell_size is 0.5');
}

{
  console.log('Test 8.2: Toggle corner cells');
  const grid = initCollisionGrid(10, 10, 1.0);
  let g = toggleCellSolid(grid, 0, 0);
  g = toggleCellSolid(g, 9, 9);
  g = toggleCellSolid(g, 0, 9);
  g = toggleCellSolid(g, 9, 0);
  assert(g.solid[0] === true, 'top-left corner solid');
  assert(g.solid[99] === true, 'bottom-right corner solid');
  assert(g.solid[90] === true, 'bottom-left corner solid');
  assert(g.solid[9] === true, 'top-right corner solid');
}

{
  console.log('Test 8.3: Grid with non-unit cell size');
  const grid = initCollisionGrid(16, 16, 2.5);
  assert(grid.cell_size === 2.5, 'cell_size preserved');
  assert(grid.width === 16, 'width preserved');
}

{
  console.log('Test 8.4: Voxel roundtrip preserves color precision');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(0, 0, 0), { color: [127, 63, 191, 200] });
  const file = saveProject(voxels, 10, 10, null, [], []);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  const v = loaded.voxels.get(voxelKey(0, 0, 0));
  assert(v !== undefined, 'voxel loaded');
  assert(v!.color[0] === 127, 'red=127');
  assert(v!.color[1] === 63, 'green=63');
  assert(v!.color[2] === 191, 'blue=191');
  assert(v!.color[3] === 200, 'alpha=200');
}

{
  console.log('Test 8.5: Multiple nav zones on same grid');
  const grid = initCollisionGrid(4, 4, 1.0);
  let g = setCellNavZone(grid, 0, 0, 1);
  g = setCellNavZone(g, 1, 0, 2);
  g = setCellNavZone(g, 2, 0, 3);
  assert(g.nav_zone[0] === 1, 'zone 1');
  assert(g.nav_zone[1] === 2, 'zone 2');
  assert(g.nav_zone[2] === 3, 'zone 3');
  assert(g.nav_zone[3] === 0, 'zone 0 (default)');
}

{
  console.log('Test 8.6: Collision and elevation on same cell');
  const grid = initCollisionGrid(4, 4, 1.0);
  let g = toggleCellSolid(grid, 1, 1);
  g = setCellElevation(g, 1, 1, 3.0);
  const idx = 1 * 4 + 1;
  assert(g.solid[idx] === true, 'cell is solid');
  assert(g.elevation[idx] === 3.0, 'cell has elevation 3.0');
}

{
  console.log('Test 8.7: Export with all entity types');
  const input = baseInput();
  input.staticLights = [{ position: [0, 0], radius: 5, height: 2, color: [1, 1, 1], intensity: 1 }];
  input.npcs = [{ name: 'A', position: [0, 0, 0], facing: 'down' }];
  input.portals = [{ position: [0, 0], size: [2, 2], target_scene: 'x', spawn_position: [0, 0, 0] }];
  input.placedObjects = [{ id: 'o', ply_file: 'a.ply', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, is_static: true }];
  const result = exportScene(input);
  assert('static_lights' in result, 'has lights');
  assert('npcs' in result, 'has npcs');
  assert('portals' in result, 'has portals');
  assert('placed_objects' in result, 'has objects');
}

{
  console.log('Test 8.8: File roundtrip with collision + voxels + zones + objects');
  const voxels = new Map<VoxelKey, Voxel>();
  voxels.set(voxelKey(5, 5, 5), { color: [128, 64, 32, 255] });
  const grid = initCollisionGrid(4, 4, 1.0);
  grid.solid[0] = true;
  grid.nav_zone[3] = 2;
  const objs: PlacedObjectData[] = [{ id: 'x', ply_file: 'test.ply', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, is_static: false }];
  const file = saveProject(voxels, 64, 48, grid, ['zone1'], objs);
  const loaded = loadProject(JSON.parse(JSON.stringify(file)));
  assert(loaded.voxels.size === 1, '1 voxel');
  assert(loaded.collisionGridData!.solid[0] === true, 'solid preserved');
  assert(loaded.collisionGridData!.nav_zone[3] === 2, 'nav_zone preserved');
  assert(loaded.navZoneNames[0] === 'zone1', 'zone name preserved');
  assert(loaded.placedObjects[0].ply_file === 'test.ply', 'object preserved');
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
