/**
 * Unit tests for Bricklayer GS particle emitter integration.
 *
 * Tests store operations (add/update/remove), scene export, and
 * save/load roundtrip for Gaussian particle emitters.
 *
 * Run: pnpm test:bricklayer-gs-emitters
 */

// ── Types (inlined to avoid React/Three.js imports) ──

interface GsParticleEmitterData {
  id: string;
  preset: string;
  position: [number, number, number];
  spawn_rate: number;
  lifetime_min: number;
  lifetime_max: number;
  velocity_min: [number, number, number];
  velocity_max: [number, number, number];
  acceleration: [number, number, number];
  color_start: [number, number, number];
  color_end: [number, number, number];
  scale_min: [number, number, number];
  scale_max: [number, number, number];
  scale_end_factor: number;
  opacity_start: number;
  opacity_end: number;
  emission: number;
  spawn_offset_min: [number, number, number];
  spawn_offset_max: [number, number, number];
  burst_duration: number;
}

// ── Store operations (mirrors useSceneStore logic) ──

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

function defaultEmitter(pos?: [number, number, number]): GsParticleEmitterData {
  return {
    id: genId('gs_emitter'),
    preset: '',
    position: pos ?? [0, 2, 0],
    spawn_rate: 10,
    lifetime_min: 0.5,
    lifetime_max: 1.5,
    velocity_min: [-1, 1, -1],
    velocity_max: [1, 3, 1],
    acceleration: [0, -9.8, 0],
    color_start: [1, 0.8, 0.3],
    color_end: [1, 0.2, 0],
    scale_min: [0.3, 0.3, 0.3],
    scale_max: [0.6, 0.6, 0.6],
    scale_end_factor: 0,
    opacity_start: 1,
    opacity_end: 0,
    emission: 0,
    spawn_offset_min: [0, 0, 0],
    spawn_offset_max: [0, 0, 0],
    burst_duration: 0,
  };
}

function addEmitter(list: GsParticleEmitterData[], pos?: [number, number, number]): GsParticleEmitterData[] {
  return [...list, defaultEmitter(pos)];
}

function updateEmitter(list: GsParticleEmitterData[], id: string, patch: Partial<GsParticleEmitterData>): GsParticleEmitterData[] {
  return list.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

function removeEmitter(list: GsParticleEmitterData[], id: string): GsParticleEmitterData[] {
  return list.filter((e) => e.id !== id);
}

// ── Preset application (mirrors GsEmittersTab logic) ──

const PRESETS: Record<string, Partial<GsParticleEmitterData>> = {
  dust_puff: {
    spawn_rate: 120, lifetime_min: 1, lifetime_max: 2.5,
    velocity_min: [-3, 1, -3], velocity_max: [3, 5, 3], acceleration: [0, -2, 0],
    color_start: [0.6, 0.55, 0.45], color_end: [0.5, 0.48, 0.4],
    scale_min: [0.1, 0.1, 0.1], scale_max: [0.3, 0.3, 0.3],
    scale_end_factor: 0.1, opacity_start: 0.4, opacity_end: 0, emission: 0,
    spawn_offset_min: [-2, 0, -2], spawn_offset_max: [2, 1, 2],
  },
  spark_shower: {
    spawn_rate: 40, lifetime_min: 0.3, lifetime_max: 0.8,
    emission: 0.8,
  },
  magic_spiral: {
    spawn_rate: 50, lifetime_min: 1.5, lifetime_max: 3,
  },
};

function applyPreset(emitter: GsParticleEmitterData, presetName: string): GsParticleEmitterData {
  const preset = PRESETS[presetName];
  if (!preset) return { ...emitter, preset: '' };
  return { ...emitter, ...preset, preset: presetName };
}

// ── Scene export (mirrors sceneExport.ts logic) ──

function exportEmitters(list: GsParticleEmitterData[]): Record<string, unknown>[] | null {
  if (list.length === 0) return null;
  return list.map((e) => {
    const out: Record<string, unknown> = {
      position: e.position,
      spawn_rate: e.spawn_rate,
      lifetime_min: e.lifetime_min,
      lifetime_max: e.lifetime_max,
      velocity_min: e.velocity_min,
      velocity_max: e.velocity_max,
      acceleration: e.acceleration,
      color_start: e.color_start,
      color_end: e.color_end,
      scale_min: e.scale_min,
      scale_max: e.scale_max,
      scale_end_factor: e.scale_end_factor,
      opacity_start: e.opacity_start,
      opacity_end: e.opacity_end,
      emission: e.emission,
      spawn_offset_min: e.spawn_offset_min,
      spawn_offset_max: e.spawn_offset_max,
    };
    if (e.preset) out.preset = e.preset;
    if (e.burst_duration > 0) out.burst_duration = e.burst_duration;
    return out;
  });
}

// ── Save/load (mirrors store saveProject/loadProject for emitters) ──

interface SavedScene {
  gsParticleEmitters?: GsParticleEmitterData[];
}

function saveEmitters(list: GsParticleEmitterData[]): SavedScene {
  return { gsParticleEmitters: list };
}

function loadEmitters(data: SavedScene): GsParticleEmitterData[] {
  return data.gsParticleEmitters ?? [];
}

// ── Grab mode (mirrors Viewport.tsx logic) ──

function getEmitterY(list: GsParticleEmitterData[], id: string): number {
  const em = list.find((e) => e.id === id);
  return em?.position[1] ?? 0;
}

function updateEmitterPosition(list: GsParticleEmitterData[], id: string, x: number, y: number, z: number): GsParticleEmitterData[] {
  return updateEmitter(list, id, { position: [x, y, z] });
}

// ── Test harness ──

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

// ── Tests ──

console.log('\n=== Bricklayer GS Particle Emitter Tests ===\n');

// 1. Store operations
console.log('--- Store operations ---\n');

{
  console.log('Test 1.1: Add emitter -> list grows');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  assert(list.length === 1, `list length is 1 (got ${list.length})`);
  assert(list[0].preset === '', 'default preset is empty');
  assert(list[0].position[1] === 2, 'default height is 2');
}

{
  console.log('Test 1.2: Add emitter with custom position');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [10, 5, 20]);
  assert(list[0].position[0] === 10, 'x = 10');
  assert(list[0].position[1] === 5, 'y = 5');
  assert(list[0].position[2] === 20, 'z = 20');
}

{
  console.log('Test 1.3: Add multiple emitters -> unique IDs');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = addEmitter(list);
  list = addEmitter(list);
  assert(list.length === 3, 'list has 3 emitters');
  assert(list[0].id !== list[1].id, 'IDs are unique (0 != 1)');
  assert(list[1].id !== list[2].id, 'IDs are unique (1 != 2)');
}

{
  console.log('Test 1.4: Update emitter -> changes applied');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const id = list[0].id;
  list = updateEmitter(list, id, { spawn_rate: 100, emission: 2.5 });
  assert(list[0].spawn_rate === 100, 'spawn_rate updated to 100');
  assert(list[0].emission === 2.5, 'emission updated to 2.5');
  assert(list[0].position[1] === 2, 'position unchanged');
}

{
  console.log('Test 1.5: Update nonexistent ID -> no crash');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = updateEmitter(list, 'nonexistent', { spawn_rate: 999 });
  assert(list[0].spawn_rate === 10, 'original emitter unchanged');
}

{
  console.log('Test 1.6: Remove emitter -> list shrinks');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = addEmitter(list);
  const id = list[0].id;
  list = removeEmitter(list, id);
  assert(list.length === 1, 'list has 1 emitter after remove');
  assert(list[0].id !== id, 'removed emitter is gone');
}

{
  console.log('Test 1.7: Remove nonexistent ID -> no crash');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = removeEmitter(list, 'nonexistent');
  assert(list.length === 1, 'list unchanged');
}

{
  console.log('Test 1.8: Default emitter has valid acceleration (gravity)');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  assert(list[0].acceleration[1] === -9.8, 'default gravity is -9.8');
}

// 2. Preset application
console.log('\n--- Preset application ---\n');

{
  console.log('Test 2.1: Apply dust_puff preset');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const updated = applyPreset(list[0], 'dust_puff');
  assert(updated.preset === 'dust_puff', 'preset name set');
  assert(updated.spawn_rate === 120, 'spawn_rate from preset');
  assert(updated.opacity_start === 0.4, 'opacity from preset');
}

{
  console.log('Test 2.2: Apply spark_shower preset');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const updated = applyPreset(list[0], 'spark_shower');
  assert(updated.preset === 'spark_shower', 'preset name set');
  assert(updated.emission === 0.8, 'emission from preset');
}

{
  console.log('Test 2.3: Apply unknown preset -> clears preset name');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const withPreset = applyPreset(list[0], 'dust_puff');
  const cleared = applyPreset(withPreset, '');
  assert(cleared.preset === '', 'preset cleared');
}

{
  console.log('Test 2.4: Preset preserves position');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [99, 88, 77]);
  const updated = applyPreset(list[0], 'dust_puff');
  assert(updated.position[0] === 99, 'position x preserved');
  assert(updated.position[1] === 88, 'position y preserved');
}

// 3. Scene export
console.log('\n--- Scene export ---\n');

{
  console.log('Test 3.1: Empty list -> null');
  const result = exportEmitters([]);
  assert(result === null, 'empty list returns null');
}

{
  console.log('Test 3.2: Single emitter -> array with position');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [5, 3, 7]);
  const result = exportEmitters(list)!;
  assert(result.length === 1, 'one emitter exported');
  const pos = result[0].position as number[];
  assert(pos[0] === 5 && pos[1] === 3 && pos[2] === 7, 'position matches');
}

{
  console.log('Test 3.3: Preset name included when set');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = updateEmitter(list, list[0].id, { preset: 'spark_shower' });
  const result = exportEmitters(list)!;
  assert(result[0].preset === 'spark_shower', 'preset in export');
}

{
  console.log('Test 3.4: Preset name omitted when empty');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const result = exportEmitters(list)!;
  assert(!('preset' in result[0]), 'no preset key when empty');
}

{
  console.log('Test 3.5: burst_duration omitted when 0');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const result = exportEmitters(list)!;
  assert(!('burst_duration' in result[0]), 'no burst_duration when 0');
}

{
  console.log('Test 3.6: burst_duration included when > 0');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  list = updateEmitter(list, list[0].id, { burst_duration: 2.5 });
  const result = exportEmitters(list)!;
  assert(result[0].burst_duration === 2.5, 'burst_duration exported');
}

// 4. Save/load roundtrip
console.log('\n--- Save/load roundtrip ---\n');

{
  console.log('Test 4.1: Empty emitters -> load -> empty');
  const saved = saveEmitters([]);
  const loaded = loadEmitters(JSON.parse(JSON.stringify(saved)));
  assert(loaded.length === 0, 'empty list after roundtrip');
}

{
  console.log('Test 4.2: Save with emitters -> load -> preserved');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [10, 5, 20]);
  list = updateEmitter(list, list[0].id, { preset: 'dust_puff', spawn_rate: 120 });
  const saved = saveEmitters(list);
  const loaded = loadEmitters(JSON.parse(JSON.stringify(saved)));
  assert(loaded.length === 1, '1 emitter after roundtrip');
  assert(loaded[0].preset === 'dust_puff', 'preset preserved');
  assert(loaded[0].spawn_rate === 120, 'spawn_rate preserved');
  assert(loaded[0].position[0] === 10, 'position preserved');
}

{
  console.log('Test 4.3: Load from file without gsParticleEmitters -> empty array');
  const loaded = loadEmitters({});
  assert(loaded.length === 0, 'missing field defaults to empty');
}

{
  console.log('Test 4.4: Multiple emitters survive roundtrip');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [1, 2, 3]);
  list = addEmitter(list, [4, 5, 6]);
  list = addEmitter(list, [7, 8, 9]);
  const saved = saveEmitters(list);
  const loaded = loadEmitters(JSON.parse(JSON.stringify(saved)));
  assert(loaded.length === 3, '3 emitters after roundtrip');
  assert(loaded[2].position[0] === 7, 'third emitter position preserved');
}

// 5. Grab mode
console.log('\n--- Grab mode ---\n');

{
  console.log('Test 5.1: Get emitter Y position');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list, [0, 7.5, 0]);
  const y = getEmitterY(list, list[0].id);
  assert(y === 7.5, `Y is 7.5 (got ${y})`);
}

{
  console.log('Test 5.2: Get Y for nonexistent ID -> 0');
  const y = getEmitterY([], 'fake');
  assert(y === 0, `Y is 0 for missing (got ${y})`);
}

{
  console.log('Test 5.3: Update emitter position via grab');
  let list: GsParticleEmitterData[] = [];
  list = addEmitter(list);
  const id = list[0].id;
  list = updateEmitterPosition(list, id, 15, 10, 25);
  assert(list[0].position[0] === 15, 'x updated');
  assert(list[0].position[1] === 10, 'y updated');
  assert(list[0].position[2] === 25, 'z updated');
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
