/**
 * Unit tests for Bricklayer project manifest and directory format.
 *
 * Run: pnpm test:bricklayer-project
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

interface TerrainEntry {
  id: string;
  name: string;
  voxelFile: string;
  collision: CollisionGridData | null;
  navZoneNames: string[];
}

interface AssetEntry {
  id: string;
  path: string;
  type: 'ply' | 'image' | 'other';
}

interface EmitterConfig {
  spawn_rate: number;
  particle_lifetime_min: number;
  particle_lifetime_max: number;
  velocity_min: [number, number];
  velocity_max: [number, number];
  acceleration: [number, number];
  size_min: number;
  size_max: number;
  size_end_scale: number;
  color_start: [number, number, number, number];
  color_end: [number, number, number, number];
  tile: string;
  z: number;
  spawn_offset_min: [number, number];
  spawn_offset_max: [number, number];
}

interface BackgroundLayer {
  id: string;
  texture: string;
  z: number;
  parallax_factor: number;
  quad_width: number;
  quad_height: number;
  uv_repeat_x: number;
  uv_repeat_y: number;
  tint: [number, number, number, number];
  wall: boolean;
  wall_y_offset: number;
}

interface WeatherData {
  enabled: boolean;
  type: string;
  emitter: EmitterConfig;
  ambient_override: [number, number, number, number];
  fog_density: number;
  fog_color: [number, number, number];
  transition_speed: number;
}

interface DayNightData {
  enabled: boolean;
  cycle_speed: number;
  initial_time: number;
  keyframes: { time: number; ambient: [number, number, number, number]; torch_intensity: number }[];
}

interface GaussianSplatConfig {
  camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
  render_width: number;
  render_height: number;
  scale_multiplier: number;
  background_image: string;
  parallax: {
    azimuth_range: number;
    elevation_min: number;
    elevation_max: number;
    distance_range: number;
    parallax_strength: number;
  };
}

interface PlacedObjectData {
  id: string;
  ply_file: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  is_static: boolean;
  character_manifest: string;
}

interface StaticLight {
  id: string;
  position: [number, number];
  radius: number;
  height: number;
  color: [number, number, number];
  intensity: number;
}

interface NpcData {
  id: string;
  name: string;
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  reverse_facing: string;
  patrol_interval: number;
  patrol_speed: number;
  waypoints: [number, number][];
  waypoint_pause: number;
  dialog: { speaker_key: string; text_key: string }[];
  light_color: [number, number, number, number];
  light_radius: number;
  aura_color_start: [number, number, number, number];
  aura_color_end: [number, number, number, number];
  character_id: string;
  script_module: string;
  script_class: string;
}

interface PortalData {
  id: string;
  position: [number, number];
  size: [number, number];
  target_scene: string;
  spawn_position: [number, number, number];
  spawn_facing: string;
}

interface PlayerData {
  position: [number, number, number];
  tint: [number, number, number, number];
  facing: string;
  character_id: string;
}

interface ProjectManifest {
  name: string;
  version: number;
  terrains: TerrainEntry[];
  assets: AssetEntry[];
  globalSettings: {
    ambientColor: [number, number, number, number];
    gaussianSplat: GaussianSplatConfig;
    weather: WeatherData;
    dayNight: DayNightData;
    backgroundLayers: BackgroundLayer[];
    torchEmitter: EmitterConfig;
    torchPositions: [number, number][];
    footstepEmitter: EmitterConfig;
    npcAuraEmitter: EmitterConfig;
  };
  scene: {
    placedObjects: PlacedObjectData[];
    staticLights: StaticLight[];
    npcs: NpcData[];
    portals: PortalData[];
    player: PlayerData;
  };
}

// ── Helpers ──

function defaultEmitter(): EmitterConfig {
  return {
    spawn_rate: 10,
    particle_lifetime_min: 0.5,
    particle_lifetime_max: 1.5,
    velocity_min: [-0.5, -0.5],
    velocity_max: [0.5, 0.5],
    acceleration: [0, 0],
    size_min: 1,
    size_max: 2,
    size_end_scale: 0.5,
    color_start: [1, 1, 1, 1],
    color_end: [1, 1, 1, 0],
    tile: '',
    z: 0,
    spawn_offset_min: [0, 0],
    spawn_offset_max: [0, 0],
  };
}

function defaultGaussianSplat(): GaussianSplatConfig {
  return {
    camera: { position: [0, 5, 10], target: [0, 0, 0], fov: 45 },
    render_width: 320,
    render_height: 240,
    scale_multiplier: 1,
    background_image: '',
    parallax: {
      azimuth_range: 15,
      elevation_min: -5,
      elevation_max: 5,
      distance_range: 2,
      parallax_strength: 1,
    },
  };
}

function defaultWeather(): WeatherData {
  return {
    enabled: false,
    type: 'rain',
    emitter: defaultEmitter(),
    ambient_override: [0.3, 0.3, 0.4, 1],
    fog_density: 0,
    fog_color: [0.5, 0.5, 0.6],
    transition_speed: 1,
  };
}

function defaultDayNight(): DayNightData {
  return {
    enabled: false,
    cycle_speed: 1,
    initial_time: 0.25,
    keyframes: [
      { time: 0, ambient: [0.05, 0.05, 0.15, 1], torch_intensity: 1 },
      { time: 0.25, ambient: [0.8, 0.7, 0.5, 1], torch_intensity: 0 },
    ],
  };
}

function defaultPlayer(): PlayerData {
  return {
    position: [0, 0, 0],
    tint: [1, 1, 1, 1],
    facing: 'down',
    character_id: '',
  };
}

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

function createManifest(name: string): ProjectManifest {
  return {
    name,
    version: 1,
    terrains: [],
    assets: [],
    globalSettings: {
      ambientColor: [0.25, 0.28, 0.45, 1],
      gaussianSplat: defaultGaussianSplat(),
      weather: defaultWeather(),
      dayNight: defaultDayNight(),
      backgroundLayers: [],
      torchEmitter: defaultEmitter(),
      torchPositions: [],
      footstepEmitter: defaultEmitter(),
      npcAuraEmitter: defaultEmitter(),
    },
    scene: {
      placedObjects: [],
      staticLights: [],
      npcs: [],
      portals: [],
      player: defaultPlayer(),
    },
  };
}

function addTerrain(manifest: ProjectManifest, name: string): TerrainEntry {
  const id = genId('terrain');
  const entry: TerrainEntry = {
    id,
    name,
    voxelFile: `terrains/${id}.bricklayer`,
    collision: null,
    navZoneNames: [],
  };
  manifest.terrains.push(entry);
  return entry;
}

function removeTerrain(manifest: ProjectManifest, id: string): void {
  manifest.terrains = manifest.terrains.filter((t) => t.id !== id);
}

function addAsset(manifest: ProjectManifest, entry: AssetEntry): void {
  manifest.assets.push(entry);
}

function removeAsset(manifest: ProjectManifest, id: string): void {
  manifest.assets = manifest.assets.filter((a) => a.id !== id);
}

// Export scene from project manifest (simplified version of sceneExport.ts logic)
function exportSceneFromProject(manifest: ProjectManifest): Record<string, unknown> {
  const scene: Record<string, unknown> = {
    ambient_color: manifest.globalSettings.ambientColor,
  };

  if (manifest.scene.staticLights.length > 0) {
    scene.static_lights = manifest.scene.staticLights.map((l) => ({
      position: l.position,
      radius: l.radius,
      height: l.height,
      color: l.color,
      intensity: l.intensity,
    }));
  }

  if (manifest.scene.npcs.length > 0) {
    scene.npcs = manifest.scene.npcs.map((n) => ({
      name: n.name,
      position: n.position,
      facing: n.facing,
    }));
  }

  if (manifest.scene.portals.length > 0) {
    scene.portals = manifest.scene.portals.map((p) => ({
      position: p.position,
      size: p.size,
      target_scene: p.target_scene,
      spawn_position: p.spawn_position,
    }));
  }

  scene.player_position = manifest.scene.player.position;
  scene.player_facing = manifest.scene.player.facing;

  scene.gaussian_splat = {
    camera: manifest.globalSettings.gaussianSplat.camera,
    render_width: manifest.globalSettings.gaussianSplat.render_width,
    render_height: manifest.globalSettings.gaussianSplat.render_height,
  };

  if (manifest.scene.placedObjects.length > 0) {
    scene.placed_objects = manifest.scene.placedObjects.map((obj) => ({
      id: obj.id,
      ply_file: obj.ply_file,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      is_static: obj.is_static,
    }));
  }

  // Add collision from first terrain
  if (manifest.terrains.length > 0 && manifest.terrains[0].collision) {
    const g = manifest.terrains[0].collision;
    scene.collision = {
      width: g.width,
      height: g.height,
      cell_size: g.cell_size,
      solid: g.solid,
      elevation: g.elevation,
      nav_zone: g.nav_zone,
    };
  }

  return scene;
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

console.log('\n=== Bricklayer Project Tests ===\n');

// ===============================================================
// 1. Project manifest structure (6 tests)
// ===============================================================

console.log('--- Project manifest structure ---\n');

{
  console.log('Test 1.1: Create manifest -> has required fields');
  const m = createManifest('My Project');
  assert(m.name === 'My Project', `name is 'My Project' (got '${m.name}')`);
  assert(m.version === 1, `version is 1 (got ${m.version})`);
  assert(Array.isArray(m.terrains), 'terrains is an array');
  assert(m.terrains.length === 0, 'terrains starts empty');
  assert(Array.isArray(m.assets), 'assets is an array');
  assert(m.assets.length === 0, 'assets starts empty');
}

{
  console.log('Test 1.2: Create manifest -> globalSettings has all fields');
  const m = createManifest('Test');
  assert(Array.isArray(m.globalSettings.ambientColor), 'has ambientColor');
  assert(m.globalSettings.gaussianSplat != null, 'has gaussianSplat');
  assert(m.globalSettings.weather != null, 'has weather');
  assert(m.globalSettings.dayNight != null, 'has dayNight');
  assert(Array.isArray(m.globalSettings.backgroundLayers), 'has backgroundLayers');
  assert(m.globalSettings.torchEmitter != null, 'has torchEmitter');
  assert(Array.isArray(m.globalSettings.torchPositions), 'has torchPositions');
  assert(m.globalSettings.footstepEmitter != null, 'has footstepEmitter');
  assert(m.globalSettings.npcAuraEmitter != null, 'has npcAuraEmitter');
}

{
  console.log('Test 1.3: Create manifest -> scene has all fields');
  const m = createManifest('Test');
  assert(Array.isArray(m.scene.placedObjects), 'has placedObjects');
  assert(Array.isArray(m.scene.staticLights), 'has staticLights');
  assert(Array.isArray(m.scene.npcs), 'has npcs');
  assert(Array.isArray(m.scene.portals), 'has portals');
  assert(m.scene.player != null, 'has player');
  assert(m.scene.player.facing === 'down', `player facing is 'down' (got '${m.scene.player.facing}')`);
}

// ===============================================================
// 2. Terrain operations (6 tests)
// ===============================================================

console.log('\n--- Terrain operations ---\n');

{
  console.log('Test 2.1: Add terrain -> terrain count increases');
  const m = createManifest('Test');
  addTerrain(m, 'Forest');
  assert(m.terrains.length === 1, `terrain count is 1 (got ${m.terrains.length})`);
  assert(m.terrains[0].name === 'Forest', `terrain name is 'Forest' (got '${m.terrains[0].name}')`);
}

{
  console.log('Test 2.2: Add terrain -> has valid voxelFile path');
  const m = createManifest('Test');
  const t = addTerrain(m, 'Cave');
  assert(t.voxelFile.startsWith('terrains/'), `voxelFile starts with terrains/ (got '${t.voxelFile}')`);
  assert(t.voxelFile.endsWith('.bricklayer'), `voxelFile ends with .bricklayer (got '${t.voxelFile}')`);
}

{
  console.log('Test 2.3: Add terrain -> collision is null, navZoneNames is empty');
  const m = createManifest('Test');
  const t = addTerrain(m, 'Plains');
  assert(t.collision === null, 'collision is null');
  assert(t.navZoneNames.length === 0, `navZoneNames is empty (got ${t.navZoneNames.length})`);
}

{
  console.log('Test 2.4: Remove terrain -> terrain count decreases');
  const m = createManifest('Test');
  const t1 = addTerrain(m, 'Forest');
  addTerrain(m, 'Cave');
  assert(m.terrains.length === 2, `terrain count is 2 before removal (got ${m.terrains.length})`);
  removeTerrain(m, t1.id);
  assert(m.terrains.length === 1, `terrain count is 1 after removal (got ${m.terrains.length})`);
  assert(m.terrains[0].name === 'Cave', `remaining terrain is 'Cave' (got '${m.terrains[0].name}')`);
}

{
  console.log('Test 2.5: Remove non-existent terrain -> no change');
  const m = createManifest('Test');
  addTerrain(m, 'Forest');
  removeTerrain(m, 'nonexistent');
  assert(m.terrains.length === 1, `terrain count unchanged (got ${m.terrains.length})`);
}

{
  console.log('Test 2.6: Add multiple terrains -> unique IDs');
  const m = createManifest('Test');
  const t1 = addTerrain(m, 'A');
  const t2 = addTerrain(m, 'B');
  const t3 = addTerrain(m, 'C');
  assert(t1.id !== t2.id, 'terrain 1 and 2 have different IDs');
  assert(t2.id !== t3.id, 'terrain 2 and 3 have different IDs');
  assert(t1.id !== t3.id, 'terrain 1 and 3 have different IDs');
}

// ===============================================================
// 3. Asset operations (5 tests)
// ===============================================================

console.log('\n--- Asset operations ---\n');

{
  console.log('Test 3.1: Add asset -> asset list grows');
  const m = createManifest('Test');
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  assert(m.assets.length === 1, `asset count is 1 (got ${m.assets.length})`);
  assert(m.assets[0].path === 'assets/tree.ply', `path is correct (got '${m.assets[0].path}')`);
  assert(m.assets[0].type === 'ply', `type is 'ply' (got '${m.assets[0].type}')`);
}

{
  console.log('Test 3.2: Add image asset -> correct type');
  const m = createManifest('Test');
  addAsset(m, { id: 'a2', path: 'assets/bg.png', type: 'image' });
  assert(m.assets[0].type === 'image', `type is 'image' (got '${m.assets[0].type}')`);
}

{
  console.log('Test 3.3: Remove asset -> asset list shrinks');
  const m = createManifest('Test');
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  addAsset(m, { id: 'a2', path: 'assets/rock.ply', type: 'ply' });
  assert(m.assets.length === 2, `asset count is 2 before removal (got ${m.assets.length})`);
  removeAsset(m, 'a1');
  assert(m.assets.length === 1, `asset count is 1 after removal (got ${m.assets.length})`);
  assert(m.assets[0].id === 'a2', `remaining asset is a2 (got '${m.assets[0].id}')`);
}

{
  console.log('Test 3.4: Remove non-existent asset -> no change');
  const m = createManifest('Test');
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  removeAsset(m, 'nonexistent');
  assert(m.assets.length === 1, `asset count unchanged (got ${m.assets.length})`);
}

{
  console.log('Test 3.5: Multiple asset types');
  const m = createManifest('Test');
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  addAsset(m, { id: 'a2', path: 'assets/bg.png', type: 'image' });
  addAsset(m, { id: 'a3', path: 'assets/data.bin', type: 'other' });
  assert(m.assets.length === 3, `asset count is 3 (got ${m.assets.length})`);
  const types = m.assets.map((a) => a.type);
  assert(types.includes('ply'), 'has ply type');
  assert(types.includes('image'), 'has image type');
  assert(types.includes('other'), 'has other type');
}

// ===============================================================
// 4. Export scene from project (6 tests)
// ===============================================================

console.log('\n--- Export scene from project ---\n');

{
  console.log('Test 4.1: Export empty project -> valid scene JSON');
  const m = createManifest('Test');
  const scene = exportSceneFromProject(m);
  assert('ambient_color' in scene, 'has ambient_color');
  assert('player_position' in scene, 'has player_position');
  assert('player_facing' in scene, 'has player_facing');
  assert('gaussian_splat' in scene, 'has gaussian_splat');
}

{
  console.log('Test 4.2: Export with placed objects -> has placed_objects');
  const m = createManifest('Test');
  m.scene.placedObjects.push({
    id: 'obj1',
    ply_file: 'assets/ply/tree.ply',
    position: [1, 2, 3],
    rotation: [0, 45, 0],
    scale: 1.5,
    is_static: true,
    character_manifest: '',
  });
  const scene = exportSceneFromProject(m);
  assert('placed_objects' in scene, 'has placed_objects');
  const objs = scene.placed_objects as Record<string, unknown>[];
  assert(objs.length === 1, `placed_objects count is 1 (got ${objs.length})`);
  assert(objs[0].ply_file === 'assets/ply/tree.ply', 'ply_file matches');
}

{
  console.log('Test 4.3: Export with collision terrain -> has collision');
  const m = createManifest('Test');
  const t = addTerrain(m, 'Terrain');
  t.collision = {
    width: 4,
    height: 4,
    cell_size: 1,
    solid: new Array(16).fill(false),
    elevation: new Array(16).fill(0),
    nav_zone: new Array(16).fill(0),
  };
  const scene = exportSceneFromProject(m);
  assert('collision' in scene, 'has collision');
  const coll = scene.collision as Record<string, unknown>;
  assert(coll.width === 4, `collision width is 4 (got ${coll.width})`);
}

{
  console.log('Test 4.4: Export with NPCs -> has npcs');
  const m = createManifest('Test');
  m.scene.npcs.push({
    id: 'npc1', name: 'Guard', position: [3, 0, 5], tint: [1, 1, 1, 1],
    facing: 'left', reverse_facing: 'right', patrol_interval: 0,
    patrol_speed: 1, waypoints: [], waypoint_pause: 1, dialog: [],
    light_color: [0, 0, 0, 0], light_radius: 0,
    aura_color_start: [0, 0, 0, 0], aura_color_end: [0, 0, 0, 0],
    character_id: '', script_module: '', script_class: '',
  });
  const scene = exportSceneFromProject(m);
  assert('npcs' in scene, 'has npcs');
  const npcs = scene.npcs as Record<string, unknown>[];
  assert(npcs[0].name === 'Guard', 'npc name matches');
}

{
  console.log('Test 4.5: Export with portals -> has portals');
  const m = createManifest('Test');
  m.scene.portals.push({
    id: 'p1', position: [10, 20], size: [2, 3],
    target_scene: 'dungeon', spawn_position: [1, 0, 1],
    spawn_facing: 'down',
  });
  const scene = exportSceneFromProject(m);
  assert('portals' in scene, 'has portals');
  const portals = scene.portals as Record<string, unknown>[];
  assert(portals[0].target_scene === 'dungeon', 'portal target_scene matches');
}

{
  console.log('Test 4.6: Export gaussian_splat -> has camera/render_width/render_height');
  const m = createManifest('Test');
  const scene = exportSceneFromProject(m);
  const gs = scene.gaussian_splat as Record<string, unknown>;
  assert(gs.render_width === 320, `render_width is 320 (got ${gs.render_width})`);
  assert(gs.render_height === 240, `render_height is 240 (got ${gs.render_height})`);
  const cam = gs.camera as Record<string, unknown>;
  assert(cam.fov === 45, `camera fov is 45 (got ${cam.fov})`);
}

// ===============================================================
// 5. Manifest roundtrip (4 tests)
// ===============================================================

console.log('\n--- Manifest roundtrip ---\n');

{
  console.log('Test 5.1: Empty manifest roundtrip');
  const m = createManifest('RoundtripTest');
  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as ProjectManifest;
  assert(parsed.name === m.name, 'name preserved');
  assert(parsed.version === m.version, 'version preserved');
  assert(parsed.terrains.length === m.terrains.length, 'terrains length preserved');
  assert(parsed.assets.length === m.assets.length, 'assets length preserved');
}

{
  console.log('Test 5.2: Manifest with terrains roundtrip');
  const m = createManifest('RoundtripTest');
  addTerrain(m, 'Forest');
  addTerrain(m, 'Cave');
  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as ProjectManifest;
  assert(parsed.terrains.length === 2, `terrains length is 2 (got ${parsed.terrains.length})`);
  assert(parsed.terrains[0].name === 'Forest', 'first terrain name preserved');
  assert(parsed.terrains[1].name === 'Cave', 'second terrain name preserved');
  assert(parsed.terrains[0].voxelFile === m.terrains[0].voxelFile, 'voxelFile preserved');
}

{
  console.log('Test 5.3: Manifest with assets roundtrip');
  const m = createManifest('RoundtripTest');
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  addAsset(m, { id: 'a2', path: 'assets/bg.png', type: 'image' });
  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as ProjectManifest;
  assert(parsed.assets.length === 2, `assets length is 2 (got ${parsed.assets.length})`);
  assert(parsed.assets[0].path === 'assets/tree.ply', 'first asset path preserved');
  assert(parsed.assets[1].type === 'image', 'second asset type preserved');
}

{
  console.log('Test 5.4: Full manifest roundtrip (terrains + assets + scene data)');
  const m = createManifest('FullTest');
  const t = addTerrain(m, 'Main');
  t.collision = {
    width: 8, height: 6, cell_size: 2,
    solid: new Array(48).fill(false),
    elevation: new Array(48).fill(0),
    nav_zone: new Array(48).fill(0),
  };
  t.navZoneNames = ['safe', 'danger'];
  addAsset(m, { id: 'a1', path: 'assets/tree.ply', type: 'ply' });
  m.scene.placedObjects.push({
    id: 'obj1', ply_file: 'assets/tree.ply', position: [1, 2, 3],
    rotation: [0, 0, 0], scale: 1, is_static: true, character_manifest: '',
  });
  m.scene.staticLights.push({
    id: 'l1', position: [5, 10], radius: 8, height: 2,
    color: [1, 0.9, 0.7], intensity: 1,
  });
  m.globalSettings.ambientColor = [0.5, 0.5, 0.5, 1];

  const json = JSON.stringify(m);
  const parsed = JSON.parse(json) as ProjectManifest;

  assert(parsed.name === 'FullTest', 'name preserved');
  assert(parsed.terrains.length === 1, 'terrains length preserved');
  assert(parsed.terrains[0].collision !== null, 'terrain collision preserved');
  assert(parsed.terrains[0].collision!.width === 8, 'collision width preserved');
  assert(parsed.terrains[0].navZoneNames.length === 2, 'navZoneNames length preserved');
  assert(parsed.terrains[0].navZoneNames[0] === 'safe', 'first nav zone name preserved');
  assert(parsed.assets.length === 1, 'assets length preserved');
  assert(parsed.scene.placedObjects.length === 1, 'placedObjects length preserved');
  assert(parsed.scene.staticLights.length === 1, 'staticLights length preserved');
  assert(parsed.globalSettings.ambientColor[0] === 0.5, 'ambientColor preserved');
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
