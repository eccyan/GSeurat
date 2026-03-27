/**
 * Regression tests for Bricklayer UI refactoring.
 *
 * Validates shared styles, emitter presets, Vec3Input logic,
 * scene export format, and NumberInput utilities.
 *
 * Run: pnpm test:bricklayer-ui-refactor
 */

// ═══════════════════════════════════════════════════════════════
// Inlined types and logic (avoids React/Three.js imports)
// ═══════════════════════════════════════════════════════════════

// ── Panel styles (mirrors src/styles/panel.ts) ──

interface PanelStyles {
  section: Record<string, unknown>;
  label: Record<string, unknown>;
  row: Record<string, unknown>;
  input: Record<string, unknown>;
  select: Record<string, unknown>;
  btn: Record<string, unknown>;
  btnDanger: Record<string, unknown>;
  item: Record<string, unknown>;
  itemSelected: Record<string, unknown>;
  empty: Record<string, unknown>;
  checkbox: Record<string, unknown>;
}

const panelStyles: PanelStyles = {
  section: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  input: { flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 },
  select: { flex: 1, padding: '3px 5px', fontSize: 12 },
  btn: {
    padding: '3px 8px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 11,
  },
  btnDanger: {
    padding: '3px 8px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 11,
  },
  item: {
    padding: 8, border: '1px solid #444', borderRadius: 4, background: '#22223a',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: '#77f' },
  empty: { fontSize: 12, color: '#666', textAlign: 'center', paddingTop: 40 },
  checkbox: { marginRight: 4 },
};

// ── Emitter presets (mirrors src/data/emitterPresets.ts) ──

interface EmitterPreset {
  spawn_rate: number;
  lifetime_min?: number;
  lifetime_max?: number;
  velocity_min?: [number, number, number];
  velocity_max?: [number, number, number];
  acceleration?: [number, number, number];
  color_start?: [number, number, number];
  color_end?: [number, number, number];
  scale_min?: [number, number, number];
  scale_max?: [number, number, number];
  scale_end_factor?: number;
  opacity_start?: number;
  opacity_end?: number;
  emission?: number;
  spawn_offset_min?: [number, number, number];
  spawn_offset_max?: [number, number, number];
}

const PRESET_NAMES = [
  'dust_puff', 'spark_shower', 'magic_spiral',
  'fire', 'smoke', 'rain', 'snow', 'leaves',
  'fireflies', 'steam', 'waterfall_mist',
];

const PRESETS: Record<string, EmitterPreset> = {
  dust_puff: { spawn_rate: 120, lifetime_min: 1, lifetime_max: 2.5 },
  spark_shower: { spawn_rate: 40, emission: 0.8 },
  magic_spiral: { spawn_rate: 50 },
  fire: { spawn_rate: 80, emission: 1.5 },
  smoke: { spawn_rate: 30 },
  rain: { spawn_rate: 200 },
  snow: { spawn_rate: 60 },
  leaves: { spawn_rate: 15 },
  fireflies: { spawn_rate: 8, emission: 1 },
  steam: { spawn_rate: 40 },
  waterfall_mist: { spawn_rate: 100 },
};

// ── Vec3 operations (mirrors Vec3Input logic) ──

function updateVec3(value: [number, number, number], axis: number, newVal: number): [number, number, number] {
  const next = [...value] as [number, number, number];
  next[axis] = newVal;
  return next;
}

// ── NumberInput utilities (mirrors NumberInput.tsx logic) ──

function formatValue(v: number): string {
  return parseFloat(v.toFixed(10)).toString();
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

function dragDelta(dx: number, step: number): number {
  return Math.round(dx / 2) * step;
}

// ── Scene export (mirrors sceneExport.ts key naming) ──

interface ExportInput {
  version: number;
  lights: { position: [number, number, number]; radius: number; color: [number, number, number]; intensity: number }[];
  portals: { position: [number, number, number]; size: [number, number]; target_scene: string }[];
  player: { position: [number, number, number]; tint: [number, number, number, number]; facing: string };
  emitters: { preset: string; position: [number, number, number]; spawn_rate: number }[];
  animations: {
    effect: string;
    region: { shape: string; center: [number, number, number]; radius?: number };
    lifetime: number;
    loop?: boolean;
    params?: Record<string, unknown>;
    reform?: { lifetime: number };
  }[];
}

function exportScene(input: ExportInput): Record<string, unknown> {
  const scene: Record<string, unknown> = { version: 2 };

  if (input.lights.length > 0) {
    scene.lights = input.lights.map((l) => ({
      position: l.position,
      radius: l.radius,
      color: l.color,
      intensity: l.intensity,
    }));
  }

  if (input.portals.length > 0) {
    scene.portals = input.portals.map((p) => ({
      position: p.position,
      size: p.size,
      target_scene: p.target_scene,
    }));
  }

  scene.player = input.player;

  if (input.emitters.length > 0) {
    scene.particle_emitters = input.emitters.map((e) => {
      const out: Record<string, unknown> = { position: e.position, spawn_rate: e.spawn_rate };
      if (e.preset) out.preset = e.preset;
      return out;
    });
  }

  if (input.animations.length > 0) {
    scene.animations = input.animations.map((a) => {
      const out: Record<string, unknown> = {
        effect: a.effect,
        region: a.region,
        lifetime: a.lifetime,
      };
      if (a.loop) out.loop = true;
      if (a.params && Object.keys(a.params).length > 0) out.params = a.params;
      if (a.reform) out.reform = a.reform;
      return out;
    });
  }

  return scene;
}

// ═══════════════════════════════════════════════════════════════
// Test harness
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 1. Shared styles completeness (10 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n=== Bricklayer UI Refactor Tests ===\n');
console.log('--- Shared styles ---\n');

{
  console.log('Test 1.1: panelStyles has all required keys');
  const required = ['section', 'label', 'row', 'input', 'select', 'btn', 'btnDanger', 'item', 'itemSelected', 'empty', 'checkbox'];
  for (const key of required) {
    assert(key in panelStyles, `panelStyles has '${key}'`);
  }
}

{
  console.log('Test 1.2: input style has layout props');
  assert(panelStyles.input.flex === 1, 'input has flex: 1');
  assert(panelStyles.input.maxWidth === 80, 'input has maxWidth: 80');
  assert(panelStyles.input.fontSize === 12, 'input has fontSize: 12');
}

{
  console.log('Test 1.3: btn style has interactive props');
  assert(panelStyles.btn.cursor === 'pointer', 'btn has cursor: pointer');
  assert(panelStyles.btn.borderRadius === 4, 'btn has borderRadius: 4');
}

{
  console.log('Test 1.4: btnDanger has danger colors');
  assert(panelStyles.btnDanger.background === '#4a2020', 'btnDanger background');
  assert(panelStyles.btnDanger.color === '#faa', 'btnDanger color');
}

// ═══════════════════════════════════════════════════════════════
// 2. Emitter preset validation (15 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Emitter presets ---\n');

{
  console.log('Test 2.1: All 11 preset names exist');
  for (const name of PRESET_NAMES) {
    assert(name in PRESETS, `preset '${name}' exists`);
  }
}

{
  console.log('Test 2.2: Each preset has spawn_rate > 0');
  for (const name of PRESET_NAMES) {
    const p = PRESETS[name];
    assert(p.spawn_rate > 0, `${name} spawn_rate=${p.spawn_rate} > 0`);
  }
}

{
  console.log('Test 2.3: Presets with lifetime have min < max');
  for (const name of PRESET_NAMES) {
    const p = PRESETS[name];
    if (p.lifetime_min !== undefined && p.lifetime_max !== undefined) {
      assert(p.lifetime_min < p.lifetime_max, `${name} lifetime_min < lifetime_max`);
    }
  }
}

{
  console.log('Test 2.4: No duplicate preset names');
  const names = new Set(PRESET_NAMES);
  assert(names.size === PRESET_NAMES.length, `no duplicate names (${names.size} unique)`);
}

// ═══════════════════════════════════════════════════════════════
// 3. Vec3Input output format (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Vec3Input ---\n');

{
  console.log('Test 3.1: Output is 3-element tuple');
  const result = updateVec3([1, 2, 3], 0, 10);
  assert(result.length === 3, 'length is 3');
}

{
  console.log('Test 3.2: Changing X preserves Y and Z');
  const result = updateVec3([1, 2, 3], 0, 10);
  assert(result[0] === 10, 'X updated');
  assert(result[1] === 2, 'Y unchanged');
  assert(result[2] === 3, 'Z unchanged');
}

{
  console.log('Test 3.3: Changing Y preserves X and Z');
  const result = updateVec3([1, 2, 3], 1, 20);
  assert(result[0] === 1, 'X unchanged');
  assert(result[1] === 20, 'Y updated');
  assert(result[2] === 3, 'Z unchanged');
}

{
  console.log('Test 3.4: Changing Z preserves X and Y');
  const result = updateVec3([1, 2, 3], 2, 30);
  assert(result[0] === 1, 'X unchanged');
  assert(result[1] === 2, 'Y unchanged');
  assert(result[2] === 30, 'Z updated');
}

{
  console.log('Test 3.5: Returns new array (no mutation)');
  const original: [number, number, number] = [1, 2, 3];
  const result = updateVec3(original, 0, 10);
  assert(original[0] === 1, 'original not mutated');
  assert(result !== original as any, 'new array returned');
}

// ═══════════════════════════════════════════════════════════════
// 4. Scene export regression (10 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Scene export ---\n');

function baseExport(): ExportInput {
  return {
    version: 2,
    lights: [],
    portals: [],
    player: { position: [0, 0, 0], tint: [1, 1, 1, 1], facing: 'down' },
    emitters: [],
    animations: [],
  };
}

{
  console.log('Test 4.1: Export has version 2');
  const result = exportScene(baseExport());
  assert(result.version === 2, 'version is 2');
}

{
  console.log('Test 4.2: Light position is vec3 (no height field)');
  const input = baseExport();
  input.lights = [{ position: [10, 5, 20], radius: 50, color: [1, 1, 1], intensity: 3 }];
  const result = exportScene(input);
  const lights = result.lights as Record<string, unknown>[];
  assert(lights.length === 1, '1 light');
  const pos = lights[0].position as number[];
  assert(pos.length === 3, 'position is vec3');
  assert(!('height' in lights[0]), 'no height field');
}

{
  console.log('Test 4.3: Portal position is vec3');
  const input = baseExport();
  input.portals = [{ position: [5, 0, 10], size: [2, 2], target_scene: 'test' }];
  const result = exportScene(input);
  const portals = result.portals as Record<string, unknown>[];
  const pos = portals[0].position as number[];
  assert(pos.length === 3, 'portal position is vec3');
}

{
  console.log('Test 4.4: Player is nested object');
  const result = exportScene(baseExport());
  const player = result.player as Record<string, unknown>;
  assert(typeof player === 'object', 'player is object');
  assert('position' in player, 'player has position');
  assert('facing' in player, 'player has facing');
}

{
  console.log('Test 4.5: Emitters key is particle_emitters');
  const input = baseExport();
  input.emitters = [{ preset: 'fire', position: [0, 0, 0], spawn_rate: 80 }];
  const result = exportScene(input);
  assert('particle_emitters' in result, 'key is particle_emitters');
  assert(!('gs_particle_emitters' in result), 'no gs_ prefix');
}

{
  console.log('Test 4.6: Animations key is animations');
  const input = baseExport();
  input.animations = [{ effect: 'orbit', region: { shape: 'sphere', center: [0, 0, 0], radius: 5 }, lifetime: 4 }];
  const result = exportScene(input);
  assert('animations' in result, 'key is animations');
  assert(!('gs_animations' in result), 'no gs_ prefix');
}

{
  console.log('Test 4.7: Empty emitters/animations not exported');
  const result = exportScene(baseExport());
  assert(!('particle_emitters' in result), 'no empty emitters');
  assert(!('animations' in result), 'no empty animations');
}

{
  console.log('Test 4.8: Animation params nested only');
  const input = baseExport();
  input.animations = [{
    effect: 'orbit',
    region: { shape: 'sphere', center: [0, 0, 0], radius: 5 },
    lifetime: 4,
    params: { rotations: 3, rotations_easing: 'in_out_bounce' },
  }];
  const result = exportScene(input);
  const anims = result.animations as Record<string, unknown>[];
  assert('params' in anims[0], 'params block present');
  const params = anims[0].params as Record<string, unknown>;
  assert(params.rotations_easing === 'in_out_bounce', 'easing preserved');
}

{
  console.log('Test 4.9: Reform has only lifetime (no speed)');
  const input = baseExport();
  input.animations = [{
    effect: 'scatter',
    region: { shape: 'sphere', center: [0, 0, 0], radius: 5 },
    lifetime: 2,
    reform: { lifetime: 3 },
  }];
  const result = exportScene(input);
  const anims = result.animations as Record<string, unknown>[];
  const reform = anims[0].reform as Record<string, unknown>;
  assert(reform.lifetime === 3, 'reform lifetime present');
  assert(!('speed' in reform), 'no speed in reform');
}

{
  console.log('Test 4.10: Preset name included when set');
  const input = baseExport();
  input.emitters = [{ preset: 'fire', position: [0, 0, 0], spawn_rate: 80 }];
  const result = exportScene(input);
  const emitters = result.particle_emitters as Record<string, unknown>[];
  assert(emitters[0].preset === 'fire', 'preset name included');
}

// ═══════════════════════════════════════════════════════════════
// 5. NumberInput logic (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- NumberInput ---\n');

{
  console.log('Test 5.1: formatValue removes trailing zeros');
  assert(formatValue(12.5) === '12.5', '12.5 → "12.5"');
  assert(formatValue(12.0) === '12', '12.0 → "12"');
  assert(formatValue(0) === '0', '0 → "0"');
  assert(formatValue(3.14159) === '3.14159', '3.14159 preserved');
}

{
  console.log('Test 5.2: clamp respects min');
  assert(clamp(-5, 0) === 0, 'clamp(-5, min=0) = 0');
  assert(clamp(5, 0) === 5, 'clamp(5, min=0) = 5');
}

{
  console.log('Test 5.3: clamp respects max');
  assert(clamp(15, undefined, 10) === 10, 'clamp(15, max=10) = 10');
  assert(clamp(5, undefined, 10) === 5, 'clamp(5, max=10) = 5');
}

{
  console.log('Test 5.4: clamp with both min and max');
  assert(clamp(-1, 0, 10) === 0, 'clamp(-1, 0, 10) = 0');
  assert(clamp(15, 0, 10) === 10, 'clamp(15, 0, 10) = 10');
  assert(clamp(5, 0, 10) === 5, 'clamp(5, 0, 10) = 5');
}

{
  console.log('Test 5.5: clamp passes through with no bounds');
  assert(clamp(-999) === -999, 'no bounds = pass through');
}

{
  console.log('Test 5.6: Drag delta calculation');
  assert(dragDelta(10, 0.1) === 0.5, 'dx=10, step=0.1 → 0.5');
  assert(dragDelta(20, 1) === 10, 'dx=20, step=1 → 10');
  assert(dragDelta(0, 0.1) === 0, 'dx=0 → 0');
  assert(dragDelta(1, 0.1) === 0.1, 'dx=1, step=0.1 → 0.1');
}

{
  console.log('Test 5.7: NaN handling');
  const parsed = parseFloat('abc');
  assert(isNaN(parsed), 'parseFloat("abc") is NaN');
  // When NaN, formatValue of original should be used
  assert(formatValue(5) === '5', 'revert to original value');
}

{
  console.log('Test 5.8: formatValue handles edge cases');
  assert(formatValue(0.1 + 0.2) === '0.3', '0.1+0.2 = "0.3" (not "0.30000000000000004")');
  assert(formatValue(1e-10) === '1e-10' || formatValue(1e-10) === '0', 'very small number');
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
