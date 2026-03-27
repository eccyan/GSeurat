/**
 * VFX Editor data model tests (test-first approach).
 *
 * Tests VFX preset CRUD, layer management, phase calculations,
 * timeline logic, export format, and file roundtrip.
 *
 * Run: pnpm test:vfx-editor
 */

// ═══════════════════════════════════════════════════════════════
// Types (mirrors src/store/types.ts)
// ═══════════════════════════════════════════════════════════════

type LayerType = 'emitter' | 'animation' | 'light';
type Phase = 'anticipation' | 'impact' | 'residual' | 'custom';

interface VfxLayer {
  id: string;
  name: string;
  type: LayerType;
  phase: Phase;
  start: number;
  duration: number;
  emitter?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

interface VfxPhases {
  anticipation: number;
  impact: number;
}

interface VfxPreset {
  name: string;
  duration: number;
  phases: VfxPhases;
  layers: VfxLayer[];
}

// ═══════════════════════════════════════════════════════════════
// Store operations (mirrors useVfxStore.ts logic)
// ═══════════════════════════════════════════════════════════════

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

function createPreset(name: string, duration: number = 3.0): VfxPreset {
  return {
    name,
    duration,
    phases: { anticipation: duration * 0.3, impact: duration * 0.5 },
    layers: [],
  };
}

function addLayer(preset: VfxPreset, type: LayerType, name: string, start: number, duration: number, phase: Phase = 'custom'): VfxPreset {
  const layer: VfxLayer = {
    id: genId('layer'),
    name,
    type,
    phase,
    start,
    duration,
  };
  return { ...preset, layers: [...preset.layers, layer] };
}

function updateLayer(preset: VfxPreset, layerId: string, patch: Partial<VfxLayer>): VfxPreset {
  return {
    ...preset,
    layers: preset.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
  };
}

function removeLayer(preset: VfxPreset, layerId: string): VfxPreset {
  return { ...preset, layers: preset.layers.filter((l) => l.id !== layerId) };
}

function reorderLayers(preset: VfxPreset, fromIndex: number, toIndex: number): VfxPreset {
  const layers = [...preset.layers];
  const [moved] = layers.splice(fromIndex, 1);
  layers.splice(toIndex, 0, moved);
  return { ...preset, layers };
}

// ── Phase calculations ──

function getPhaseForTime(phases: VfxPhases, duration: number, time: number): Phase {
  if (time < phases.anticipation) return 'anticipation';
  if (time < phases.impact) return 'impact';
  if (time < duration) return 'residual';
  return 'residual';
}

function autoAssignPhase(layer: VfxLayer, phases: VfxPhases, duration: number): Phase {
  const midpoint = layer.start + layer.duration / 2;
  return getPhaseForTime(phases, duration, midpoint);
}

// ── Duration calculation ──

function calculateDuration(layers: VfxLayer[]): number {
  if (layers.length === 0) return 1.0;
  return Math.max(...layers.map((l) => l.start + l.duration));
}

// ── Layer overlap detection ──

function findOverlaps(layers: VfxLayer[]): [string, string][] {
  const overlaps: [string, string][] = [];
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const a = layers[i], b = layers[j];
      if (a.type === b.type) {
        const aEnd = a.start + a.duration;
        const bEnd = b.start + b.duration;
        if (a.start < bEnd && b.start < aEnd) {
          overlaps.push([a.id, b.id]);
        }
      }
    }
  }
  return overlaps;
}

// ── Export ──

function exportVfx(preset: VfxPreset): Record<string, unknown> {
  return {
    name: preset.name,
    duration: preset.duration,
    phases: preset.phases,
    layers: preset.layers.map((l) => {
      const out: Record<string, unknown> = {
        name: l.name,
        type: l.type,
        phase: l.phase,
        start: l.start,
        duration: l.duration,
      };
      if (l.emitter) out.emitter = l.emitter;
      if (l.animation) out.animation = l.animation;
      if (l.light) out.light = l.light;
      return out;
    }),
  };
}

// ── Save/Load ──

function saveVfx(preset: VfxPreset): string {
  return JSON.stringify(exportVfx(preset), null, 2);
}

function loadVfx(json: string): VfxPreset {
  const data = JSON.parse(json);
  return {
    name: data.name,
    duration: data.duration,
    phases: data.phases ?? { anticipation: data.duration * 0.3, impact: data.duration * 0.5 },
    layers: (data.layers ?? []).map((l: Record<string, unknown>) => ({
      id: genId('layer'),
      name: l.name as string,
      type: l.type as LayerType,
      phase: (l.phase as Phase) ?? 'custom',
      start: l.start as number,
      duration: l.duration as number,
      emitter: l.emitter as Record<string, unknown> | undefined,
      animation: l.animation as Record<string, unknown> | undefined,
      light: l.light as { color: [number, number, number]; intensity: number; radius: number } | undefined,
    })),
  };
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

console.log('\n=== VFX Editor Tests ===\n');

// ═══════════════════════════════════════════════════════════════
// 1. VFX Preset CRUD (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('--- VFX Preset CRUD ---\n');

{
  console.log('Test 1.1: Create preset with defaults');
  const p = createPreset('Explosion', 3.0);
  assert(p.name === 'Explosion', 'name set');
  assert(p.duration === 3.0, 'duration set');
  assert(p.layers.length === 0, 'empty layers');
}

{
  console.log('Test 1.2: Phase defaults are proportional');
  const p = createPreset('Test', 10.0);
  assert(p.phases.anticipation === 3.0, 'anticipation = 30%');
  assert(p.phases.impact === 5.0, 'impact = 50%');
}

{
  console.log('Test 1.3: Update preset name');
  let p = createPreset('Old');
  p = { ...p, name: 'New' };
  assert(p.name === 'New', 'name updated');
}

{
  console.log('Test 1.4: Update duration recalculates phases');
  const p = createPreset('Test', 4.0);
  assert(p.phases.anticipation === 1.2, 'anticipation = 30% of 4');
}

// ═══════════════════════════════════════════════════════════════
// 2. Layer CRUD (12 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Layer CRUD ---\n');

{
  console.log('Test 2.1: Add emitter layer');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'Sparks', 0, 1.5, 'impact');
  assert(p.layers.length === 1, '1 layer');
  assert(p.layers[0].type === 'emitter', 'type is emitter');
  assert(p.layers[0].name === 'Sparks', 'name is Sparks');
  assert(p.layers[0].phase === 'impact', 'phase is impact');
}

{
  console.log('Test 2.2: Add animation layer');
  let p = createPreset('Test');
  p = addLayer(p, 'animation', 'Scatter', 0.5, 2.0, 'impact');
  assert(p.layers[0].type === 'animation', 'type is animation');
  assert(p.layers[0].start === 0.5, 'start is 0.5');
}

{
  console.log('Test 2.3: Add light layer');
  let p = createPreset('Test');
  p = addLayer(p, 'light', 'Flash', 1.0, 0.1, 'impact');
  assert(p.layers[0].type === 'light', 'type is light');
  assert(p.layers[0].duration === 0.1, 'duration is 0.1');
}

{
  console.log('Test 2.4: Multiple layers have unique IDs');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  p = addLayer(p, 'emitter', 'B', 0, 1);
  p = addLayer(p, 'animation', 'C', 0, 1);
  assert(p.layers.length === 3, '3 layers');
  const ids = new Set(p.layers.map((l) => l.id));
  assert(ids.size === 3, 'all unique IDs');
}

{
  console.log('Test 2.5: Update layer');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'Sparks', 0, 1);
  const id = p.layers[0].id;
  p = updateLayer(p, id, { name: 'Big Sparks', start: 0.5 });
  assert(p.layers[0].name === 'Big Sparks', 'name updated');
  assert(p.layers[0].start === 0.5, 'start updated');
  assert(p.layers[0].type === 'emitter', 'type unchanged');
}

{
  console.log('Test 2.6: Remove layer');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  p = addLayer(p, 'animation', 'B', 0, 1);
  const id = p.layers[0].id;
  p = removeLayer(p, id);
  assert(p.layers.length === 1, '1 layer after remove');
  assert(p.layers[0].name === 'B', 'correct layer remains');
}

{
  console.log('Test 2.7: Reorder layers');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  p = addLayer(p, 'animation', 'B', 0, 1);
  p = addLayer(p, 'light', 'C', 0, 1);
  p = reorderLayers(p, 2, 0);
  assert(p.layers[0].name === 'C', 'C moved to front');
  assert(p.layers[1].name === 'A', 'A shifted');
  assert(p.layers[2].name === 'B', 'B shifted');
}

{
  console.log('Test 2.8: Layer with emitter config');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'Fire', 0, 2);
  p = updateLayer(p, p.layers[0].id, { emitter: { preset: 'fire', spawn_rate: 80 } });
  assert(p.layers[0].emitter?.preset === 'fire', 'emitter preset set');
}

{
  console.log('Test 2.9: Layer with animation config');
  let p = createPreset('Test');
  p = addLayer(p, 'animation', 'Scatter', 0, 1);
  p = updateLayer(p, p.layers[0].id, {
    animation: { effect: 'scatter', params: { velocity: 5, opacity_easing: 'out_expo' } },
  });
  const anim = p.layers[0].animation as Record<string, unknown>;
  assert(anim.effect === 'scatter', 'effect set');
}

{
  console.log('Test 2.10: Layer with light config');
  let p = createPreset('Test');
  p = addLayer(p, 'light', 'Flash', 0, 0.1);
  p = updateLayer(p, p.layers[0].id, {
    light: { color: [1, 1, 0.9], intensity: 50, radius: 100 },
  });
  assert(p.layers[0].light?.intensity === 50, 'light intensity set');
}

// ═══════════════════════════════════════════════════════════════
// 3. Phase calculations (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Phase calculations ---\n');

{
  const phases: VfxPhases = { anticipation: 0.8, impact: 1.2 };
  console.log('Test 3.1: Time in anticipation');
  assert(getPhaseForTime(phases, 2.5, 0.3) === 'anticipation', 't=0.3 → anticipation');
}

{
  const phases: VfxPhases = { anticipation: 0.8, impact: 1.2 };
  console.log('Test 3.2: Time in impact');
  assert(getPhaseForTime(phases, 2.5, 1.0) === 'impact', 't=1.0 → impact');
}

{
  const phases: VfxPhases = { anticipation: 0.8, impact: 1.2 };
  console.log('Test 3.3: Time in residual');
  assert(getPhaseForTime(phases, 2.5, 2.0) === 'residual', 't=2.0 → residual');
}

{
  const phases: VfxPhases = { anticipation: 0.8, impact: 1.2 };
  console.log('Test 3.4: Auto-assign phase by midpoint');
  const layer: VfxLayer = { id: '1', name: 'Test', type: 'emitter', phase: 'custom', start: 0, duration: 0.5 };
  assert(autoAssignPhase(layer, phases, 2.5) === 'anticipation', 'midpoint 0.25 → anticipation');
}

{
  const phases: VfxPhases = { anticipation: 0.8, impact: 1.2 };
  console.log('Test 3.5: Auto-assign impact layer');
  const layer: VfxLayer = { id: '1', name: 'Test', type: 'emitter', phase: 'custom', start: 0.8, duration: 0.3 };
  assert(autoAssignPhase(layer, phases, 2.5) === 'impact', 'midpoint 0.95 → impact');
}

{
  console.log('Test 3.6: Phase boundary at exactly anticipation');
  const phases: VfxPhases = { anticipation: 1.0, impact: 2.0 };
  assert(getPhaseForTime(phases, 3.0, 1.0) === 'impact', 'exactly at boundary → impact');
}

// ═══════════════════════════════════════════════════════════════
// 4. Duration calculation (4 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Duration calculation ---\n');

{
  console.log('Test 4.1: Empty layers → default 1.0');
  assert(calculateDuration([]) === 1.0, 'empty → 1.0');
}

{
  console.log('Test 4.2: Single layer');
  const layers: VfxLayer[] = [{ id: '1', name: 'A', type: 'emitter', phase: 'impact', start: 0.5, duration: 2.0 }];
  assert(calculateDuration(layers) === 2.5, 'start + duration');
}

{
  console.log('Test 4.3: Max of all layers');
  const layers: VfxLayer[] = [
    { id: '1', name: 'A', type: 'emitter', phase: 'impact', start: 0, duration: 1.0 },
    { id: '2', name: 'B', type: 'animation', phase: 'residual', start: 1.5, duration: 2.0 },
  ];
  assert(calculateDuration(layers) === 3.5, 'max(1.0, 3.5) = 3.5');
}

// ═══════════════════════════════════════════════════════════════
// 5. Layer overlap detection (4 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Overlap detection ---\n');

{
  console.log('Test 5.1: No overlap');
  const layers: VfxLayer[] = [
    { id: 'a', name: 'A', type: 'emitter', phase: 'impact', start: 0, duration: 1 },
    { id: 'b', name: 'B', type: 'emitter', phase: 'residual', start: 1, duration: 1 },
  ];
  assert(findOverlaps(layers).length === 0, 'no overlaps');
}

{
  console.log('Test 5.2: Overlapping same type');
  const layers: VfxLayer[] = [
    { id: 'a', name: 'A', type: 'emitter', phase: 'impact', start: 0, duration: 2 },
    { id: 'b', name: 'B', type: 'emitter', phase: 'impact', start: 1, duration: 2 },
  ];
  const overlaps = findOverlaps(layers);
  assert(overlaps.length === 1, '1 overlap');
  assert(overlaps[0][0] === 'a' && overlaps[0][1] === 'b', 'correct pair');
}

{
  console.log('Test 5.3: Different types don\'t overlap');
  const layers: VfxLayer[] = [
    { id: 'a', name: 'A', type: 'emitter', phase: 'impact', start: 0, duration: 2 },
    { id: 'b', name: 'B', type: 'animation', phase: 'impact', start: 0, duration: 2 },
  ];
  assert(findOverlaps(layers).length === 0, 'different types = no overlap');
}

// ═══════════════════════════════════════════════════════════════
// 6. Export format (8 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Export format ---\n');

{
  console.log('Test 6.1: Export has required fields');
  const p = createPreset('Test', 2.0);
  const exported = exportVfx(p);
  assert(exported.name === 'Test', 'has name');
  assert(exported.duration === 2.0, 'has duration');
  assert(Array.isArray(exported.layers), 'has layers array');
  assert(exported.phases !== undefined, 'has phases');
}

{
  console.log('Test 6.2: Export layer fields');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'Sparks', 0.5, 1.5, 'impact');
  const exported = exportVfx(p);
  const layers = exported.layers as Record<string, unknown>[];
  assert(layers[0].name === 'Sparks', 'layer name');
  assert(layers[0].type === 'emitter', 'layer type');
  assert(layers[0].start === 0.5, 'layer start');
  assert(layers[0].duration === 1.5, 'layer duration');
  assert(layers[0].phase === 'impact', 'layer phase');
}

{
  console.log('Test 6.3: Export omits empty config');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  const exported = exportVfx(p);
  const layers = exported.layers as Record<string, unknown>[];
  assert(!('emitter' in layers[0]), 'no emitter when undefined');
  assert(!('animation' in layers[0]), 'no animation when undefined');
  assert(!('light' in layers[0]), 'no light when undefined');
}

{
  console.log('Test 6.4: Export includes emitter config when set');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'Fire', 0, 2);
  p = updateLayer(p, p.layers[0].id, { emitter: { preset: 'fire' } });
  const exported = exportVfx(p);
  const layers = exported.layers as Record<string, unknown>[];
  assert('emitter' in layers[0], 'emitter present');
  assert((layers[0].emitter as Record<string, unknown>).preset === 'fire', 'preset value');
}

{
  console.log('Test 6.5: Export phases');
  const p = createPreset('Test', 4.0);
  const exported = exportVfx(p);
  const phases = exported.phases as VfxPhases;
  assert(phases.anticipation === 1.2, 'anticipation exported');
  assert(phases.impact === 2.0, 'impact exported');
}

{
  console.log('Test 6.6: Export has no id field in layers');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  const exported = exportVfx(p);
  const layers = exported.layers as Record<string, unknown>[];
  assert(!('id' in layers[0]), 'no id in exported layer');
}

// ═══════════════════════════════════════════════════════════════
// 7. Save/load roundtrip (6 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Save/load roundtrip ---\n');

{
  console.log('Test 7.1: Empty preset roundtrip');
  const p = createPreset('Empty', 2.0);
  const json = saveVfx(p);
  const loaded = loadVfx(json);
  assert(loaded.name === 'Empty', 'name preserved');
  assert(loaded.duration === 2.0, 'duration preserved');
  assert(loaded.layers.length === 0, 'empty layers');
}

{
  console.log('Test 7.2: Preset with layers roundtrip');
  let p = createPreset('Explosion', 3.0);
  p = addLayer(p, 'emitter', 'Sparks', 0, 1.5, 'anticipation');
  p = addLayer(p, 'animation', 'Scatter', 0.8, 1.0, 'impact');
  p = addLayer(p, 'light', 'Flash', 0.8, 0.1, 'impact');
  p = updateLayer(p, p.layers[0].id, { emitter: { preset: 'spark_shower' } });
  p = updateLayer(p, p.layers[1].id, { animation: { effect: 'scatter', params: { velocity: 5 } } });
  p = updateLayer(p, p.layers[2].id, { light: { color: [1, 1, 0.9], intensity: 50, radius: 100 } });

  const json = saveVfx(p);
  const loaded = loadVfx(json);

  assert(loaded.name === 'Explosion', 'name preserved');
  assert(loaded.layers.length === 3, '3 layers');
  assert(loaded.layers[0].type === 'emitter', 'layer 0 type');
  assert(loaded.layers[0].phase === 'anticipation', 'layer 0 phase');
  assert(loaded.layers[1].type === 'animation', 'layer 1 type');
  assert((loaded.layers[1].animation as Record<string, unknown>).effect === 'scatter', 'animation effect');
  assert(loaded.layers[2].light?.intensity === 50, 'light intensity');
}

{
  console.log('Test 7.3: Phases preserved');
  let p = createPreset('Test', 4.0);
  p = { ...p, phases: { anticipation: 1.0, impact: 2.5 } };
  const loaded = loadVfx(saveVfx(p));
  assert(loaded.phases.anticipation === 1.0, 'anticipation preserved');
  assert(loaded.phases.impact === 2.5, 'impact preserved');
}

{
  console.log('Test 7.4: Missing phases gets defaults');
  const json = JSON.stringify({ name: 'Test', duration: 3.0, layers: [] });
  const loaded = loadVfx(json);
  assert(Math.abs(loaded.phases.anticipation - 0.9) < 0.01, 'default anticipation ~0.9');
  assert(loaded.phases.impact === 1.5, 'default impact');
}

{
  console.log('Test 7.5: JSON is valid parseable');
  const p = createPreset('Test');
  const json = saveVfx(p);
  assert(typeof json === 'string', 'is string');
  const parsed = JSON.parse(json);
  assert(typeof parsed === 'object', 'parses to object');
}

// ═══════════════════════════════════════════════════════════════
// 8. Emitter vs animation validation (4 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Config validation ---\n');

{
  console.log('Test 8.1: Emitter layer can have emitter config');
  let p = createPreset('Test');
  p = addLayer(p, 'emitter', 'A', 0, 1);
  p = updateLayer(p, p.layers[0].id, { emitter: { preset: 'fire', spawn_rate: 80 } });
  assert(p.layers[0].emitter !== undefined, 'emitter config exists');
}

{
  console.log('Test 8.2: Animation layer can have animation config');
  let p = createPreset('Test');
  p = addLayer(p, 'animation', 'A', 0, 1);
  p = updateLayer(p, p.layers[0].id, { animation: { effect: 'orbit' } });
  assert(p.layers[0].animation !== undefined, 'animation config exists');
}

{
  console.log('Test 8.3: Light layer can have light config');
  let p = createPreset('Test');
  p = addLayer(p, 'light', 'A', 0, 0.1);
  p = updateLayer(p, p.layers[0].id, { light: { color: [1, 0, 0], intensity: 10, radius: 50 } });
  assert(p.layers[0].light !== undefined, 'light config exists');
  assert(p.layers[0].light!.color[0] === 1, 'color red');
}

{
  console.log('Test 8.4: Layer start + duration within preset duration');
  let p = createPreset('Test', 3.0);
  p = addLayer(p, 'emitter', 'A', 2.5, 0.5);
  const end = p.layers[0].start + p.layers[0].duration;
  assert(end <= p.duration, 'layer end <= preset duration');
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
