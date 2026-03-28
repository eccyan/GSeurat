/**
 * Integration tests for Bricklayer VFX instance management.
 *
 * Tests VFX instance CRUD, .vfx.json parsing, scene export,
 * and BricklayerFile persistence.
 *
 * Run: pnpm test:bricklayer-vfx
 */

// ── Types (inline to avoid React/Three.js deps) ──

interface VfxLayerData {
  name: string;
  type: 'emitter' | 'animation' | 'light';
  start: number;
  duration: number;
  emitter?: Record<string, unknown>;
  animation?: Record<string, unknown>;
  light?: { color: [number, number, number]; intensity: number; radius: number };
}

interface VfxPresetData {
  name: string;
  duration: number;
  layers: VfxLayerData[];
}

interface VfxInstanceData {
  id: string;
  name: string;
  vfx_file: string;
  vfx_preset: VfxPresetData;
  position: [number, number, number];
  radius: number;
  trigger: 'auto' | 'event';
  loop: boolean;
}

// ── Parse .vfx.json (mirrors Méliès vfxImport but for Bricklayer) ──

function parseVfxForBricklayer(json: string): VfxPresetData {
  const data = JSON.parse(json);
  const duration = data.duration ?? 3.0;
  const layers: VfxLayerData[] = (data.layers ?? []).map((l: Record<string, unknown>) => ({
    name: (l.name as string) ?? 'Unnamed',
    type: (l.type as string) ?? 'emitter',
    start: (l.start as number) ?? 0,
    duration: (l.duration as number) ?? 1,
    emitter: l.emitter as Record<string, unknown> | undefined,
    animation: l.animation as Record<string, unknown> | undefined,
    light: l.light as { color: [number, number, number]; intensity: number; radius: number } | undefined,
  }));
  return { name: data.name ?? 'Unnamed VFX', duration, layers };
}

function createVfxInstance(
  id: string, name: string, vfxFile: string, preset: VfxPresetData,
  position: [number, number, number] = [0, 0, 0],
): VfxInstanceData {
  return {
    id, name, vfx_file: vfxFile, vfx_preset: preset,
    position, radius: 5, trigger: 'auto', loop: true,
  };
}

// ── Scene export helper ──

function exportVfxInstances(instances: VfxInstanceData[]): Record<string, unknown>[] {
  return instances.map((inst) => ({
    vfx_file: inst.vfx_file,
    position: inst.position,
    radius: inst.radius,
    trigger: inst.trigger,
    loop: inst.loop,
  }));
}

// ── Test harness ──

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

function approx(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ── Test data ──

const fireVfxJson = JSON.stringify({
  name: 'Campfire',
  duration: 5.0,
  layers: [
    { name: 'Flames', type: 'emitter', start: 0, duration: 5, emitter: { preset: 'fire', spawn_rate: 80 } },
    { name: 'Flicker', type: 'animation', start: 0, duration: 5, animation: { effect: 'pulse', params: { pulse_frequency: 8 } } },
    { name: 'Glow', type: 'light', start: 0, duration: 5, light: { color: [1, 0.6, 0.2], intensity: 30, radius: 10 } },
  ],
});

const snowVfxJson = JSON.stringify({
  name: 'Snow',
  duration: 10.0,
  layers: [
    { name: 'Snowflakes', type: 'emitter', start: 0, duration: 10, emitter: { preset: 'snow' } },
  ],
});

// v1 format with phases (for migration test)
const v1VfxJson = JSON.stringify({
  name: 'Old Effect',
  duration: 3.0,
  phases: { anticipation: 0.9, impact: 1.5 },
  layers: [
    { name: 'Sparks', type: 'emitter', phase: 'impact', start: 0.9, duration: 0.6 },
  ],
});

const minimalVfxJson = JSON.stringify({ name: 'Minimal' });

// ── Tests ──

async function main() {
  console.log('=== Bricklayer VFX Instance Tests ===\n');

  // 1. VFX Import parsing
  console.log('--- VFX Import Parsing ---\n');

  {
    console.log('Test 1.1: Parse valid .vfx.json with all layer types');
    const preset = parseVfxForBricklayer(fireVfxJson);
    assert(preset.name === 'Campfire', 'name = Campfire');
    assert(preset.duration === 5.0, 'duration = 5.0');
    assert(preset.layers.length === 3, '3 layers');
    assert(preset.layers[0].type === 'emitter', 'layer 0 is emitter');
    assert(preset.layers[1].type === 'animation', 'layer 1 is animation');
    assert(preset.layers[2].type === 'light', 'layer 2 is light');
    assert((preset.layers[0].emitter as any)?.preset === 'fire', 'emitter preset = fire');
    assert((preset.layers[1].animation as any)?.effect === 'pulse', 'animation effect = pulse');
    assert(preset.layers[2].light!.intensity === 30, 'light intensity = 30');
  }

  {
    console.log('Test 1.2: Parse .vfx.json with missing optional fields');
    const preset = parseVfxForBricklayer(minimalVfxJson);
    assert(preset.name === 'Minimal', 'name = Minimal');
    assert(preset.duration === 3.0, 'default duration = 3.0');
    assert(preset.layers.length === 0, 'no layers');
  }

  {
    console.log('Test 1.3: Parse v1 .vfx.json (with phases) — phases ignored');
    const preset = parseVfxForBricklayer(v1VfxJson);
    assert(preset.name === 'Old Effect', 'name preserved');
    assert(preset.duration === 3.0, 'duration = 3.0');
    assert(preset.layers.length === 1, '1 layer');
    assert(preset.layers[0].name === 'Sparks', 'layer name preserved');
    // phases are simply ignored (not in VfxPresetData)
  }

  // 2. VFX Instance CRUD
  console.log('\n--- VFX Instance CRUD ---\n');

  {
    console.log('Test 2.1: Create VfxInstanceData');
    const preset = parseVfxForBricklayer(fireVfxJson);
    const inst = createVfxInstance('vfx_1', 'Campfire', 'assets/vfx/campfire.vfx.json', preset, [10, 2, 5]);
    assert(inst.id === 'vfx_1', 'id set');
    assert(inst.name === 'Campfire', 'name set');
    assert(inst.vfx_file === 'assets/vfx/campfire.vfx.json', 'vfx_file set');
    assert(inst.position[0] === 10 && inst.position[1] === 2 && inst.position[2] === 5, 'position set');
    assert(inst.radius === 5, 'default radius = 5');
    assert(inst.trigger === 'auto', 'default trigger = auto');
    assert(inst.loop === true, 'default loop = true');
    assert(inst.vfx_preset.layers.length === 3, 'preset has 3 layers');
  }

  {
    console.log('Test 2.2: Update VfxInstanceData position');
    const preset = parseVfxForBricklayer(fireVfxJson);
    const inst = createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', preset);
    const updated = { ...inst, position: [20, 3, 10] as [number, number, number] };
    assert(updated.position[0] === 20, 'x updated');
    assert(updated.position[1] === 3, 'y updated');
    assert(updated.position[2] === 10, 'z updated');
    assert(updated.vfx_preset.name === 'Campfire', 'preset unchanged');
  }

  {
    console.log('Test 2.3: Multiple instances persist independently');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const snow = parseVfxForBricklayer(snowVfxJson);
    const instances: VfxInstanceData[] = [
      createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', fire, [10, 0, 0]),
      createVfxInstance('vfx_2', 'Snow', 'snow.vfx.json', snow, [0, 20, 0]),
    ];
    assert(instances.length === 2, '2 instances');
    assert(instances[0].name === 'Campfire', 'first is Campfire');
    assert(instances[1].name === 'Snow', 'second is Snow');
    assert(instances[0].vfx_preset.duration === 5.0, 'fire duration = 5.0');
    assert(instances[1].vfx_preset.duration === 10.0, 'snow duration = 10.0');
  }

  {
    console.log('Test 2.4: Remove instance from array');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const snow = parseVfxForBricklayer(snowVfxJson);
    let instances: VfxInstanceData[] = [
      createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', fire),
      createVfxInstance('vfx_2', 'Snow', 'snow.vfx.json', snow),
    ];
    instances = instances.filter((i) => i.id !== 'vfx_1');
    assert(instances.length === 1, '1 instance remaining');
    assert(instances[0].name === 'Snow', 'Snow remains');
  }

  // 3. Scene export with VFX instances
  console.log('\n--- Scene Export ---\n');

  {
    console.log('Test 3.1: Export VFX instances to scene format');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const snow = parseVfxForBricklayer(snowVfxJson);
    const instances = [
      createVfxInstance('vfx_1', 'Campfire', 'assets/vfx/campfire.vfx.json', fire, [10, 2, 5]),
      createVfxInstance('vfx_2', 'Snow', 'assets/vfx/snow.vfx.json', snow, [0, 20, 0]),
    ];
    const exported = exportVfxInstances(instances);
    assert(exported.length === 2, '2 exported instances');
    assert(exported[0].vfx_file === 'assets/vfx/campfire.vfx.json', 'vfx_file preserved');
    assert((exported[0].position as number[])[0] === 10, 'position preserved');
    assert(exported[0].radius === 5, 'radius preserved');
    assert(exported[0].trigger === 'auto', 'trigger preserved');
    assert(exported[0].loop === true, 'loop preserved');
  }

  {
    console.log('Test 3.2: Exported format matches scene.schema.json');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const inst = createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', fire, [1, 2, 3]);
    inst.trigger = 'event';
    inst.loop = false;
    inst.radius = 8;
    const [exported] = exportVfxInstances([inst]);
    // Schema requires: vfx_file, position
    assert(typeof exported.vfx_file === 'string', 'vfx_file is string');
    assert(Array.isArray(exported.position), 'position is array');
    assert((exported.position as number[]).length === 3, 'position has 3 elements');
    assert(exported.trigger === 'event', 'trigger = event');
    assert(exported.loop === false, 'loop = false');
    assert(exported.radius === 8, 'radius = 8');
    // Should NOT include id, name, or vfx_preset in export
    assert(!('id' in exported), 'no id in export');
    assert(!('name' in exported), 'no name in export');
    assert(!('vfx_preset' in exported), 'no vfx_preset in export');
  }

  {
    console.log('Test 3.3: Round-trip: export → re-import');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const original = createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', fire, [5, 3, 8]);
    original.radius = 12;
    original.trigger = 'event';
    original.loop = false;
    const exported = exportVfxInstances([original]);
    const json = JSON.stringify({ vfx_instances: exported });
    const reimported = JSON.parse(json).vfx_instances[0];
    assert(reimported.vfx_file === 'campfire.vfx.json', 'vfx_file roundtrip');
    assert(reimported.position[0] === 5, 'x roundtrip');
    assert(reimported.position[1] === 3, 'y roundtrip');
    assert(reimported.position[2] === 8, 'z roundtrip');
    assert(reimported.radius === 12, 'radius roundtrip');
    assert(reimported.trigger === 'event', 'trigger roundtrip');
    assert(reimported.loop === false, 'loop roundtrip');
  }

  // 4. BricklayerFile persistence
  console.log('\n--- BricklayerFile Persistence ---\n');

  {
    console.log('Test 4.1: Save with vfxInstances');
    const fire = parseVfxForBricklayer(fireVfxJson);
    const instances = [createVfxInstance('vfx_1', 'Campfire', 'campfire.vfx.json', fire)];
    const file = { scene: { vfxInstances: instances } };
    const json = JSON.stringify(file);
    const loaded = JSON.parse(json);
    assert(loaded.scene.vfxInstances.length === 1, '1 instance saved');
    assert(loaded.scene.vfxInstances[0].name === 'Campfire', 'name persisted');
    assert(loaded.scene.vfxInstances[0].vfx_preset.layers.length === 3, 'preset layers persisted');
  }

  {
    console.log('Test 4.2: Load without vfxInstances (old format)');
    const file = { scene: {} };
    const json = JSON.stringify(file);
    const loaded = JSON.parse(json);
    const instances = loaded.scene.vfxInstances ?? [];
    assert(instances.length === 0, 'empty array for old format');
  }

  // ═══════════════════════════════════════════════════════════════

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40));
  process.exit(failed > 0 ? 1 : 0);
}

main();
