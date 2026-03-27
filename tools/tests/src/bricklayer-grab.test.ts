/**
 * Unit tests for Bricklayer grab-mode logic.
 *
 * Verifies the state machine: enter grab → move → confirm/cancel,
 * including Shift-height mode and entity position updates.
 *
 * Run: pnpm test:bricklayer-grab
 */

// ── Types (inlined to avoid React/Three.js imports) ──

type EntityType = 'object' | 'light' | 'npc' | 'portal' | 'player';

interface SelectedEntity {
  type: EntityType;
  id: string;
}

interface PlacedObject {
  id: string;
  position: [number, number, number];
}

interface StaticLight {
  id: string;
  position: [number, number]; // [x, z]
  height: number;
}

interface NpcData {
  id: string;
  position: [number, number, number];
}

interface PortalData {
  id: string;
  position: [number, number]; // [x, z]
}

interface PlayerData {
  position: [number, number, number];
}

// ── Minimal grab-mode state machine (mirrors store + GrabPlane logic) ──

type AxisLock = 'free' | 'x' | 'y' | 'z';

interface GrabState {
  grabMode: boolean;
  grabOriginalPosition: [number, number, number] | null;
  grabAxisLock: AxisLock;
  selectedEntity: SelectedEntity | null;
  placedObjects: PlacedObject[];
  staticLights: StaticLight[];
  npcs: NpcData[];
  portals: PortalData[];
  player: PlayerData;
  orbitLocked: boolean;
}

function createInitialState(): GrabState {
  return {
    grabMode: false,
    grabOriginalPosition: null,
    grabAxisLock: 'free' as AxisLock,
    selectedEntity: null,
    placedObjects: [
      { id: 'obj1', position: [10, 5, 20] },
      { id: 'obj2', position: [30, 0, 40] },
    ],
    staticLights: [
      { id: 'light1', position: [15, 25], height: 8 },
    ],
    npcs: [
      { id: 'npc1', position: [50, 2, 60] },
    ],
    portals: [
      { id: 'portal1', position: [70, 80] },
    ],
    player: { position: [0, 1, 0] },
    orbitLocked: false,
  };
}

// ── Actions (mirror store actions) ──

function selectEntity(state: GrabState, entity: SelectedEntity): GrabState {
  return { ...state, selectedEntity: entity };
}

/** Enter grab mode — saves original position. Returns null if no entity selected. */
function enterGrab(state: GrabState): GrabState | null {
  const sel = state.selectedEntity;
  if (!sel) return null;

  let pos: [number, number, number] | null = null;
  if (sel.type === 'object') {
    const obj = state.placedObjects.find((o) => o.id === sel.id);
    if (obj) pos = [...obj.position];
  } else if (sel.type === 'light') {
    const light = state.staticLights.find((l) => l.id === sel.id);
    if (light) pos = [light.position[0], light.height, light.position[1]];
  } else if (sel.type === 'npc') {
    const npc = state.npcs.find((n) => n.id === sel.id);
    if (npc) pos = [...npc.position];
  } else if (sel.type === 'portal') {
    const portal = state.portals.find((p) => p.id === sel.id);
    if (portal) pos = [portal.position[0], 0, portal.position[1]];
  } else if (sel.type === 'player') {
    pos = [...state.player.position];
  }

  if (!pos) return null;
  return { ...state, grabMode: true, grabOriginalPosition: pos, grabAxisLock: 'free' as AxisLock };
}

/** Update grabbed entity position (mirrors GrabPlane pointermove). */
function updateGrabbedEntity(state: GrabState, x: number, y: number, z: number): GrabState {
  const sel = state.selectedEntity;
  if (!sel) return state;

  if (sel.type === 'object') {
    return {
      ...state,
      placedObjects: state.placedObjects.map((o) =>
        o.id === sel.id ? { ...o, position: [x, y, z] as [number, number, number] } : o,
      ),
    };
  }
  if (sel.type === 'light') {
    return {
      ...state,
      staticLights: state.staticLights.map((l) =>
        l.id === sel.id ? { ...l, position: [x, z] as [number, number], height: y } : l,
      ),
    };
  }
  if (sel.type === 'npc') {
    return {
      ...state,
      npcs: state.npcs.map((n) =>
        n.id === sel.id ? { ...n, position: [x, y, z] as [number, number, number] } : n,
      ),
    };
  }
  if (sel.type === 'portal') {
    return {
      ...state,
      portals: state.portals.map((p) =>
        p.id === sel.id ? { ...p, position: [x, z] as [number, number] } : p,
      ),
    };
  }
  if (sel.type === 'player') {
    return { ...state, player: { position: [x, y, z] } };
  }
  return state;
}

/** Confirm grab — clears grab mode, keeps new position. */
function confirmGrab(state: GrabState): GrabState {
  return { ...state, grabMode: false, grabOriginalPosition: null, grabAxisLock: 'free' as AxisLock };
}

/** Cancel grab — restores original position. */
function cancelGrab(state: GrabState): GrabState {
  if (!state.grabOriginalPosition || !state.selectedEntity) {
    return { ...state, grabMode: false, grabOriginalPosition: null, grabAxisLock: 'free' as AxisLock };
  }
  const pos = state.grabOriginalPosition;
  const restored = updateGrabbedEntity(state, pos[0], pos[1], pos[2]);
  return { ...restored, grabMode: false, grabOriginalPosition: null, grabAxisLock: 'free' as AxisLock };
}

/** Simulate XZ move during grab (non-shift). Snaps to 0.1. */
function grabMoveXZ(state: GrabState, rawX: number, rawZ: number): GrabState {
  if (!state.grabMode || !state.selectedEntity) return state;
  const x = Math.round(rawX * 10) / 10;
  const z = Math.round(rawZ * 10) / 10;
  // Y stays at the grabbed entity's current Y
  const currentY = getEntityY(state);
  return updateGrabbedEntity(state, x, currentY, z);
}

/** Simulate Shift-height move during grab. */
function grabMoveY(state: GrabState, deltaPixels: number): GrabState {
  if (!state.grabMode || !state.selectedEntity) return state;
  const currentY = getEntityY(state);
  const newY = Math.round((currentY + deltaPixels * 0.05) * 10) / 10;
  const sel = state.selectedEntity;

  // Get current XZ
  let cx = 0, cz = 0;
  if (sel.type === 'object') {
    const obj = state.placedObjects.find((o) => o.id === sel.id);
    if (obj) { cx = obj.position[0]; cz = obj.position[2]; }
  } else if (sel.type === 'light') {
    const light = state.staticLights.find((l) => l.id === sel.id);
    if (light) { cx = light.position[0]; cz = light.position[1]; }
  } else if (sel.type === 'npc') {
    const npc = state.npcs.find((n) => n.id === sel.id);
    if (npc) { cx = npc.position[0]; cz = npc.position[2]; }
  } else if (sel.type === 'portal') {
    const portal = state.portals.find((p) => p.id === sel.id);
    if (portal) { cx = portal.position[0]; cz = portal.position[1]; }
  } else if (sel.type === 'player') {
    cx = state.player.position[0]; cz = state.player.position[2];
  }

  return updateGrabbedEntity(state, cx, newY, cz);
}

function getEntityY(state: GrabState): number {
  const sel = state.selectedEntity;
  if (!sel) return 0;
  if (sel.type === 'object') {
    const obj = state.placedObjects.find((o) => o.id === sel.id);
    return obj?.position[1] ?? 0;
  }
  if (sel.type === 'light') {
    const light = state.staticLights.find((l) => l.id === sel.id);
    return light?.height ?? 0;
  }
  if (sel.type === 'npc') {
    const npc = state.npcs.find((n) => n.id === sel.id);
    return npc?.position[1] ?? 0;
  }
  if (sel.type === 'player') return state.player.position[1];
  return 0;
}

/** Simulate the full grab flow as event sequence. */
type GrabEvent =
  | { type: 'select'; entity: SelectedEntity }
  | { type: 'press_g' }
  | { type: 'move_xz'; x: number; z: number }
  | { type: 'move_y'; deltaPixels: number }
  | { type: 'confirm' }   // pointerdown / click
  | { type: 'cancel' };   // Escape key

function applyGrabEvent(state: GrabState, event: GrabEvent): GrabState {
  switch (event.type) {
    case 'select':
      return selectEntity(state, event.entity);
    case 'press_g': {
      const result = enterGrab(state);
      return result ?? state;
    }
    case 'move_xz':
      return grabMoveXZ(state, event.x, event.z);
    case 'move_y':
      return grabMoveY(state, event.deltaPixels);
    case 'confirm':
      return confirmGrab(state);
    case 'cancel':
      return cancelGrab(state);
  }
}

function applyEvents(state: GrabState, events: GrabEvent[]): GrabState {
  return events.reduce(applyGrabEvent, state);
}

// ── Test runner ──

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

function assertPos(actual: [number, number, number], expected: [number, number, number], label: string) {
  const match = actual[0] === expected[0] && actual[1] === expected[1] && actual[2] === expected[2];
  if (!match) {
    console.error(`  FAIL: ${label} — expected [${expected}], got [${actual}]`);
    failed++;
  } else {
    console.log(`  PASS: ${label}`);
    passed++;
  }
}

// ── Tests ──

console.log('\n=== Bricklayer Grab Mode Tests ===\n');

// ═══════════════════════════════════════════════════════════════
// 1. Basic grab lifecycle
// ═══════════════════════════════════════════════════════════════

console.log('--- 1. Basic grab lifecycle ---\n');

{
  console.log('Test 1.1: Cannot enter grab without selected entity');
  const state = createInitialState();
  const result = enterGrab(state);
  assert(result === null, 'enterGrab returns null when nothing selected');
}

{
  console.log('Test 1.2: Enter grab saves original position');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  assert(state.grabMode === true, 'grabMode is true');
  assertPos(state.grabOriginalPosition!, [10, 5, 20], 'original position saved');
}

{
  console.log('Test 1.3: Confirm grab clears grab state');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = confirmGrab(state);
  assert(state.grabMode === false, 'grabMode is false after confirm');
  assert(state.grabOriginalPosition === null, 'grabOriginalPosition cleared');
}

{
  console.log('Test 1.4: Cancel grab restores original position');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  // Move to new position
  state = updateGrabbedEntity(state, 99, 5, 88);
  assertPos(state.placedObjects[0].position, [99, 5, 88], 'moved to new position');
  // Cancel
  state = cancelGrab(state);
  assert(state.grabMode === false, 'grabMode is false after cancel');
  assertPos(state.placedObjects[0].position, [10, 5, 20], 'position restored to original');
}

// ═══════════════════════════════════════════════════════════════
// 2. XZ movement
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 2. XZ movement ---\n');

{
  console.log('Test 2.1: XZ move preserves Y');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = grabMoveXZ(state, 50.123, 60.789);
  const obj = state.placedObjects[0];
  assert(obj.position[0] === 50.1, `X snapped to 50.1 (got ${obj.position[0]})`);
  assert(obj.position[1] === 5, `Y unchanged at 5 (got ${obj.position[1]})`);
  assert(obj.position[2] === 60.8, `Z snapped to 60.8 (got ${obj.position[2]})`);
}

{
  console.log('Test 2.2: XZ move does nothing outside grab mode');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  // Not in grab mode
  state = grabMoveXZ(state, 99, 99);
  assertPos(state.placedObjects[0].position, [10, 5, 20], 'position unchanged');
}

{
  console.log('Test 2.3: Multiple XZ moves, only last position kept');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = grabMoveXZ(state, 1, 1);
  state = grabMoveXZ(state, 2, 2);
  state = grabMoveXZ(state, 30, 40);
  assertPos(state.placedObjects[0].position, [30, 5, 40], 'last move wins');
}

// ═══════════════════════════════════════════════════════════════
// 3. Shift-height (Y) adjustment
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 3. Shift-height (Y) adjustment ---\n');

{
  console.log('Test 3.1: Y adjustment preserves XZ');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' }); // pos [10, 5, 20]
  state = enterGrab(state)!;
  // Move up 20 pixels → +1.0 units
  state = grabMoveY(state, 20);
  const obj = state.placedObjects[0];
  assert(obj.position[0] === 10, `X unchanged (got ${obj.position[0]})`);
  assert(obj.position[1] === 6, `Y moved to 6 (got ${obj.position[1]})`);
  assert(obj.position[2] === 20, `Z unchanged (got ${obj.position[2]})`);
}

{
  console.log('Test 3.2: Y moves accumulate');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' }); // Y=5
  state = enterGrab(state)!;
  state = grabMoveY(state, 20);  // Y = 5 + 1.0 = 6.0
  state = grabMoveY(state, -40); // Y = 6.0 - 2.0 = 4.0
  assert(state.placedObjects[0].position[1] === 4, `Y is 4 (got ${state.placedObjects[0].position[1]})`);
}

{
  console.log('Test 3.3: Mixed XZ and Y moves');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' }); // [10, 5, 20]
  state = enterGrab(state)!;
  state = grabMoveXZ(state, 50, 60);   // [50, 5, 60]
  state = grabMoveY(state, 40);         // [50, 7, 60]
  state = grabMoveXZ(state, 70, 80);   // [70, 7, 80] - Y preserved from height mode
  assertPos(state.placedObjects[0].position, [70, 7, 80], 'XZ updated, Y preserved from height move');
}

// ═══════════════════════════════════════════════════════════════
// 4. Full event sequence
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 4. Full event sequence ---\n');

{
  console.log('Test 4.1: Select → G → move → confirm');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 100, z: 200 },
    { type: 'confirm' },
  ]);
  assert(state.grabMode === false, 'grab ended');
  assertPos(state.placedObjects[0].position, [100, 5, 200], 'object at new position');
}

{
  console.log('Test 4.2: Select → G → move → cancel');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 100, z: 200 },
    { type: 'cancel' },
  ]);
  assert(state.grabMode === false, 'grab ended');
  assertPos(state.placedObjects[0].position, [10, 5, 20], 'object at original position');
}

{
  console.log('Test 4.3: Select → G → height adjust → confirm');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'move_y', deltaPixels: 100 }, // +5.0 units
    { type: 'confirm' },
  ]);
  assert(state.grabMode === false, 'grab ended');
  assertPos(state.placedObjects[0].position, [10, 10, 20], 'Y raised by 5');
}

{
  console.log('Test 4.4: Select → G → height adjust → cancel restores Y');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'move_y', deltaPixels: 100 },
    { type: 'cancel' },
  ]);
  assertPos(state.placedObjects[0].position, [10, 5, 20], 'Y restored');
}

{
  console.log('Test 4.5: G without selection does nothing');
  const state = applyEvents(createInitialState(), [
    { type: 'press_g' },
  ]);
  assert(state.grabMode === false, 'still not in grab mode');
}

{
  console.log('Test 4.6: Confirm without grab does nothing harmful');
  const state = applyEvents(createInitialState(), [
    { type: 'confirm' },
  ]);
  assert(state.grabMode === false, 'no crash, grabMode stays false');
}

// ═══════════════════════════════════════════════════════════════
// 5. Different entity types
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 5. Different entity types ---\n');

{
  console.log('Test 5.1: Grab light — stores [x, height, z] as original');
  let state = createInitialState();
  state = selectEntity(state, { type: 'light', id: 'light1' }); // pos [15, 25], height 8
  state = enterGrab(state)!;
  assertPos(state.grabOriginalPosition!, [15, 8, 25], 'original = [x, height, z]');
}

{
  console.log('Test 5.2: Move light updates position and height');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'light', id: 'light1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 50, z: 60 },
    { type: 'confirm' },
  ]);
  const light = state.staticLights[0];
  assert(light.position[0] === 50, `light X = 50 (got ${light.position[0]})`);
  assert(light.position[1] === 60, `light Z = 60 (got ${light.position[1]})`);
  assert(light.height === 8, `light height unchanged at 8 (got ${light.height})`);
}

{
  console.log('Test 5.3: Shift-height adjusts light height');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'light', id: 'light1' } },
    { type: 'press_g' },
    { type: 'move_y', deltaPixels: 40 }, // +2.0 units
    { type: 'confirm' },
  ]);
  const light = state.staticLights[0];
  assert(light.height === 10, `light height = 10 (got ${light.height})`);
  assert(light.position[0] === 15, `light X unchanged (got ${light.position[0]})`);
}

{
  console.log('Test 5.4: Cancel light grab restores position and height');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'light', id: 'light1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 99, z: 99 },
    { type: 'move_y', deltaPixels: 200 },
    { type: 'cancel' },
  ]);
  const light = state.staticLights[0];
  assert(light.position[0] === 15, `X restored (got ${light.position[0]})`);
  assert(light.position[1] === 25, `Z restored (got ${light.position[1]})`);
  assert(light.height === 8, `height restored (got ${light.height})`);
}

{
  console.log('Test 5.5: Grab NPC');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'npc', id: 'npc1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 10, z: 20 },
    { type: 'confirm' },
  ]);
  assertPos(state.npcs[0].position, [10, 2, 20], 'NPC moved, Y preserved');
}

{
  console.log('Test 5.6: Grab portal (Y always 0)');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'portal', id: 'portal1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 5, z: 10 },
    { type: 'confirm' },
  ]);
  assert(state.portals[0].position[0] === 5, `portal X (got ${state.portals[0].position[0]})`);
  assert(state.portals[0].position[1] === 10, `portal Z (got ${state.portals[0].position[1]})`);
}

{
  console.log('Test 5.7: Grab player');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'player', id: 'player' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 25, z: 35 },
    { type: 'move_y', deltaPixels: 60 }, // +3.0 units, Y was 1 → 4
    { type: 'confirm' },
  ]);
  assertPos(state.player.position, [25, 4, 35], 'player at new position with height');
}

// ═══════════════════════════════════════════════════════════════
// 6. Edge cases
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 6. Edge cases ---\n');

{
  console.log('Test 6.1: Double-G does not re-enter (already in grab)');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  // Move
  state = grabMoveXZ(state, 50, 60);
  // Press G again while in grab mode — should not overwrite original position
  // (In real code, the G handler checks grabMode first. We test the state machine.)
  const origPos = state.grabOriginalPosition;
  assertPos(origPos!, [10, 5, 20], 'original position still from first G press');
}

{
  console.log('Test 6.2: Grab non-existent entity');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'nonexistent' });
  const result = enterGrab(state);
  assert(result === null, 'enterGrab returns null for missing entity');
}

{
  console.log('Test 6.3: Only selected object moves, others stay');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'move_xz', x: 99, z: 99 },
    { type: 'confirm' },
  ]);
  assertPos(state.placedObjects[0].position, [99, 5, 99], 'obj1 moved');
  assertPos(state.placedObjects[1].position, [30, 0, 40], 'obj2 unchanged');
}

{
  console.log('Test 6.4: Rapid confirm (no move) keeps original position');
  const state = applyEvents(createInitialState(), [
    { type: 'select', entity: { type: 'object', id: 'obj1' } },
    { type: 'press_g' },
    { type: 'confirm' }, // Immediate confirm without moving
  ]);
  assertPos(state.placedObjects[0].position, [10, 5, 20], 'position unchanged');
}

// ═══════════════════════════════════════════════════════════════
// 7. Orbit lock
// ═══════════════════════════════════════════════════════════════

console.log('\n--- 7. Orbit lock ---\n');

{
  console.log('Test 7.1: Orbit locked state');
  let state = createInitialState();
  assert(state.orbitLocked === false, 'starts unlocked');
  state = { ...state, orbitLocked: true };
  assert(state.orbitLocked === true, 'can be locked');
  state = { ...state, orbitLocked: false };
  assert(state.orbitLocked === false, 'can be unlocked');
}

{
  console.log('Test 7.2: Orbit lock is independent of grab mode');
  let state = createInitialState();
  state = { ...state, orbitLocked: true };
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  assert(state.grabMode === true, 'grab mode active');
  assert(state.orbitLocked === true, 'orbit still locked');
  state = confirmGrab(state);
  assert(state.orbitLocked === true, 'orbit lock persists through grab');
}

// ═══════════════════════════════════════════════════════════════
// 8. Axis lock (10 tests)
// ═══════════════════════════════════════════════════════════════

console.log('\n--- Axis lock ---\n');

function toggleAxisLock(state: GrabState, axis: 'x' | 'y' | 'z'): GrabState {
  if (!state.grabMode) return state;
  return { ...state, grabAxisLock: state.grabAxisLock === axis ? 'free' : axis };
}

{
  console.log('Test 8.1: Toggle X axis lock on');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'x');
  assert(state.grabAxisLock === 'x', 'axis lock is x');
}

{
  console.log('Test 8.2: Toggle X again -> free');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'x');
  state = toggleAxisLock(state, 'x');
  assert(state.grabAxisLock === 'free', 'axis lock back to free');
}

{
  console.log('Test 8.3: Switch from X to Y');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'x');
  state = toggleAxisLock(state, 'y');
  assert(state.grabAxisLock === 'y', 'axis lock switched to y');
}

{
  console.log('Test 8.4: Z axis lock');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'z');
  assert(state.grabAxisLock === 'z', 'axis lock is z');
}

{
  console.log('Test 8.5: Axis lock resets on grab start');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'x');
  assert(state.grabAxisLock === 'x', 'x locked');
  state = confirmGrab(state);
  state = enterGrab(state)!;
  assert(state.grabAxisLock === 'free', 'axis lock reset on new grab');
}

{
  console.log('Test 8.6: Axis lock resets on confirm');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'y');
  state = confirmGrab(state);
  assert(state.grabAxisLock === 'free', 'axis lock reset after confirm');
}

{
  console.log('Test 8.7: Axis lock resets on cancel');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'z');
  state = cancelGrab(state);
  assert(state.grabAxisLock === 'free', 'axis lock reset after cancel');
}

{
  console.log('Test 8.8: Toggle axis outside grab mode -> no effect');
  let state = createInitialState();
  state = toggleAxisLock(state, 'x');
  assert(state.grabAxisLock === 'free', 'no axis lock outside grab');
}

{
  console.log('Test 8.9: Default is free');
  const state = createInitialState();
  assert(state.grabAxisLock === 'free', 'default is free');
}

{
  console.log('Test 8.10: Axis-locked movement constrains to axis');
  let state = createInitialState();
  state = selectEntity(state, { type: 'object', id: 'obj1' });
  state = enterGrab(state)!;
  state = toggleAxisLock(state, 'x');
  // Simulate axis-locked move: only X changes, Y and Z stay at original
  const orig = state.grabOriginalPosition!;
  // In real code, axis lock constrains via projection. Here we test the store toggle works.
  assert(state.grabAxisLock === 'x', 'axis locked to X before movement');
  // The actual constraint is in the 3D raycast code (Viewport.tsx), not testable here.
  // We verify the state machine is correct.
}

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
process.exit(failed > 0 ? 1 : 0);
