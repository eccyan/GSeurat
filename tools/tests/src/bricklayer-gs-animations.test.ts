/**
 * Unit tests for Bricklayer GS animation integration.
 *
 * Tests store operations (add/update/remove), scene export, and
 * save/load roundtrip for GS animation groups.
 *
 * Run: pnpm test:bricklayer-gs-animations
 */

// ── Types (inlined to avoid React/Three.js imports) ──

interface GsAnimationGroupData {
  id: string;
  effect: string;
  shape: string;
  center: [number, number, number];
  radius: number;
  half_extents: [number, number, number];
  lifetime: number;
  loop: boolean;
}

// ── Store operations ──

let idCounter = 0;
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++idCounter}`;
}

function defaultAnimation(center?: [number, number, number]): GsAnimationGroupData {
  return {
    id: genId('gs_anim'),
    effect: 'orbit',
    shape: 'sphere',
    center: center ?? [0, 2, 0],
    radius: 5,
    half_extents: [5, 5, 5],
    lifetime: 4,
    loop: true,
  };
}

function addAnimation(list: GsAnimationGroupData[], center?: [number, number, number]): GsAnimationGroupData[] {
  return [...list, defaultAnimation(center)];
}

function updateAnimation(list: GsAnimationGroupData[], id: string, patch: Partial<GsAnimationGroupData>): GsAnimationGroupData[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a));
}

function removeAnimation(list: GsAnimationGroupData[], id: string): GsAnimationGroupData[] {
  return list.filter((a) => a.id !== id);
}

// ── Scene export ──

function exportAnimations(list: GsAnimationGroupData[]): Record<string, unknown>[] | null {
  if (list.length === 0) return null;
  return list.map((a) => {
    const region: Record<string, unknown> = {
      shape: a.shape,
      center: a.center,
    };
    if (a.shape === 'sphere') region.radius = a.radius;
    else region.half_extents = a.half_extents;
    const out: Record<string, unknown> = {
      effect: a.effect,
      region,
      lifetime: a.lifetime,
    };
    if (a.loop) out.loop = true;
    return out;
  });
}

// ── Save/load ──

interface SavedScene {
  gsAnimations?: GsAnimationGroupData[];
}

function saveAnimations(list: GsAnimationGroupData[]): SavedScene {
  return { gsAnimations: list };
}

function loadAnimations(data: SavedScene): GsAnimationGroupData[] {
  return data.gsAnimations ?? [];
}

// ── Grab mode ──

function getAnimationY(list: GsAnimationGroupData[], id: string): number {
  const anim = list.find((a) => a.id === id);
  return anim?.center[1] ?? 0;
}

function updateAnimationCenter(list: GsAnimationGroupData[], id: string, x: number, y: number, z: number): GsAnimationGroupData[] {
  return updateAnimation(list, id, { center: [x, y, z] });
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

console.log('\n=== Bricklayer GS Animation Tests ===\n');

// 1. Store operations
console.log('--- Store operations ---\n');

{
  console.log('Test 1.1: Add animation -> list grows');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  assert(list.length === 1, `length is 1 (got ${list.length})`);
  assert(list[0].effect === 'orbit', 'default effect is orbit');
  assert(list[0].shape === 'sphere', 'default shape is sphere');
  assert(list[0].loop === true, 'default loop is true');
}

{
  console.log('Test 1.2: Add with custom center');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list, [10, 5, 20]);
  assert(list[0].center[0] === 10, 'x = 10');
  assert(list[0].center[1] === 5, 'y = 5');
}

{
  console.log('Test 1.3: Multiple animations -> unique IDs');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = addAnimation(list);
  assert(list.length === 2, 'list has 2');
  assert(list[0].id !== list[1].id, 'IDs are unique');
}

{
  console.log('Test 1.4: Update animation -> changes applied');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  const id = list[0].id;
  list = updateAnimation(list, id, { effect: 'dissolve', lifetime: 10, loop: false });
  assert(list[0].effect === 'dissolve', 'effect updated');
  assert(list[0].lifetime === 10, 'lifetime updated');
  assert(list[0].loop === false, 'loop updated');
}

{
  console.log('Test 1.5: Update shape to box');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = updateAnimation(list, list[0].id, { shape: 'box', half_extents: [3, 4, 5] });
  assert(list[0].shape === 'box', 'shape is box');
  assert(list[0].half_extents[2] === 5, 'half_extents z = 5');
}

{
  console.log('Test 1.6: Remove animation');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = addAnimation(list);
  const id = list[0].id;
  list = removeAnimation(list, id);
  assert(list.length === 1, 'list has 1 after remove');
}

// 2. Scene export
console.log('\n--- Scene export ---\n');

{
  console.log('Test 2.1: Empty list -> null');
  assert(exportAnimations([]) === null, 'empty returns null');
}

{
  console.log('Test 2.2: Sphere animation export');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list, [5, 3, 7]);
  list = updateAnimation(list, list[0].id, { effect: 'float', radius: 8 });
  const result = exportAnimations(list)!;
  assert(result.length === 1, 'one animation');
  assert(result[0].effect === 'float', 'effect is float');
  const region = result[0].region as Record<string, unknown>;
  assert(region.shape === 'sphere', 'shape is sphere');
  assert(region.radius === 8, 'radius is 8');
}

{
  console.log('Test 2.3: Box animation export');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = updateAnimation(list, list[0].id, { shape: 'box', half_extents: [2, 3, 4] });
  const result = exportAnimations(list)!;
  const region = result[0].region as Record<string, unknown>;
  assert(region.shape === 'box', 'shape is box');
  assert(!('radius' in region), 'no radius for box');
  const he = region.half_extents as number[];
  assert(he[0] === 2 && he[1] === 3 && he[2] === 4, 'half_extents match');
}

{
  console.log('Test 2.4: Loop included when true, omitted when false');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = updateAnimation(list, list[0].id, { loop: true });
  const r1 = exportAnimations(list)!;
  assert(r1[0].loop === true, 'loop=true exported');

  list = updateAnimation(list, list[0].id, { loop: false });
  const r2 = exportAnimations(list)!;
  assert(!('loop' in r2[0]), 'loop=false omitted');
}

// 3. Save/load roundtrip
console.log('\n--- Save/load roundtrip ---\n');

{
  console.log('Test 3.1: Empty -> roundtrip -> empty');
  const loaded = loadAnimations(JSON.parse(JSON.stringify(saveAnimations([]))));
  assert(loaded.length === 0, 'empty after roundtrip');
}

{
  console.log('Test 3.2: With animations -> roundtrip -> preserved');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list, [10, 5, 20]);
  list = updateAnimation(list, list[0].id, { effect: 'detach', lifetime: 7, loop: false });
  const loaded = loadAnimations(JSON.parse(JSON.stringify(saveAnimations(list))));
  assert(loaded.length === 1, '1 animation');
  assert(loaded[0].effect === 'detach', 'effect preserved');
  assert(loaded[0].lifetime === 7, 'lifetime preserved');
  assert(loaded[0].center[0] === 10, 'center preserved');
}

{
  console.log('Test 3.3: Missing field -> defaults to empty');
  const loaded = loadAnimations({});
  assert(loaded.length === 0, 'missing field = empty');
}

// 4. Grab mode
console.log('\n--- Grab mode ---\n');

{
  console.log('Test 4.1: Get animation Y');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list, [0, 7.5, 0]);
  assert(getAnimationY(list, list[0].id) === 7.5, 'Y = 7.5');
}

{
  console.log('Test 4.2: Get Y for missing -> 0');
  assert(getAnimationY([], 'fake') === 0, 'Y = 0 for missing');
}

{
  console.log('Test 4.3: Update center via grab');
  let list: GsAnimationGroupData[] = [];
  list = addAnimation(list);
  list = updateAnimationCenter(list, list[0].id, 15, 10, 25);
  assert(list[0].center[0] === 15, 'x updated');
  assert(list[0].center[1] === 10, 'y updated');
  assert(list[0].center[2] === 25, 'z updated');
}

// 5. All effect types
console.log('\n--- Effect types ---\n');

{
  console.log('Test 5.1: All 9 effects are valid');
  const effects = ['detach', 'float', 'orbit', 'dissolve', 'reform', 'pulse', 'vortex', 'wave', 'scatter'];
  for (const e of effects) {
    let list: GsAnimationGroupData[] = [];
    list = addAnimation(list);
    list = updateAnimation(list, list[0].id, { effect: e });
    assert(list[0].effect === e, `effect '${e}' stored`);
    const exported = exportAnimations(list)!;
    assert(exported[0].effect === e, `effect '${e}' exported`);
  }
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
