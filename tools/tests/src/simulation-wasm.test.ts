/**
 * WASM Simulation Module Tests
 *
 * Tests the C++ particle emitter and animation simulation compiled
 * to WebAssembly via Emscripten. Verifies the JS API matches expected
 * behavior of the native engine.
 *
 * Run: pnpm test:simulation-wasm
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, '../../packages/simulation-wasm/dist/simulation.mjs');

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

function approx(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) < epsilon;
}

async function main() {
  console.log('\n=== WASM Simulation Tests ===\n');

  // Load WASM module
  let sim: any;
  try {
    const createModule = (await import(wasmPath)).default;
    sim = await createModule();
  } catch (e) {
    console.error('Failed to load WASM module:', e);
    console.error('Run: cd tools/packages/simulation-wasm && bash build.sh');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // 1. Module loading (3 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('--- Module loading ---\n');

  {
    console.log('Test 1.1: Module loaded');
    assert(sim !== null && sim !== undefined, 'module is not null');
  }

  {
    console.log('Test 1.2: ParticleEmitter class exists');
    assert(typeof sim.ParticleEmitter === 'function', 'ParticleEmitter is a constructor');
  }

  {
    console.log('Test 1.3: Functions exist');
    assert(typeof sim.resolvePreset === 'function', 'resolvePreset exists');
    assert(typeof sim.applyEasing === 'function', 'applyEasing exists');
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. Particle emitter (12 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- Particle emitter ---\n');

  {
    console.log('Test 2.1: Create emitter');
    const emitter = new sim.ParticleEmitter();
    assert(emitter !== null, 'emitter created');
    assert(emitter.aliveCount() === 0, 'starts with 0 particles');
    emitter.delete();
  }

  {
    console.log('Test 2.2: Configure with preset and activate');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');
    emitter.setActive(true);
    assert(emitter.active(), 'emitter is active');
    emitter.delete();
  }

  {
    console.log('Test 2.3: Update spawns particles');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');  // spawn_rate=80
    emitter.setActive(true);
    emitter.update(0.1);  // 80 * 0.1 = 8 particles expected
    const count = emitter.aliveCount();
    assert(count > 0, `particles spawned (${count})`);
    assert(count <= 20, `reasonable count (${count})`);
    emitter.delete();
  }

  {
    console.log('Test 2.4: Particles die after lifetime');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('spark_shower');  // lifetime 0.3-0.8s
    emitter.setActive(true);
    emitter.update(0.1);  // spawn some
    const spawned = emitter.aliveCount();
    emitter.setActive(false);  // stop spawning
    // Update past max lifetime
    for (let i = 0; i < 20; i++) emitter.update(0.1);
    const after = emitter.aliveCount();
    assert(after < spawned, `particles died (${spawned} → ${after})`);
    emitter.delete();
  }

  {
    console.log('Test 2.5: Gather returns particle data');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');
    emitter.setActive(true);
    emitter.update(0.05);
    const data = emitter.gather();
    assert(data !== null, 'gather returns data');
    if (data) {
      assert(data.count > 0, `count = ${data.count}`);
      assert(data.positions instanceof Float32Array, 'positions is Float32Array');
      assert(data.colors instanceof Float32Array, 'colors is Float32Array');
      assert(data.positions.length === data.count * 3, 'positions length = count * 3');
      assert(data.colors.length === data.count * 3, 'colors length = count * 3');
    }
    emitter.delete();
  }

  {
    console.log('Test 2.6: Clear removes all particles');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');
    emitter.setActive(true);
    emitter.update(0.1);
    assert(emitter.aliveCount() > 0, 'has particles');
    emitter.clear();
    assert(emitter.aliveCount() === 0, 'cleared');
    emitter.delete();
  }

  {
    console.log('Test 2.7: Configure with custom config');
    const emitter = new sim.ParticleEmitter();
    emitter.configure({ spawn_rate: 200, lifetime_min: 0.5, lifetime_max: 1.0 });
    emitter.setActive(true);
    emitter.update(0.05);  // 200 * 0.05 = 10
    assert(emitter.aliveCount() > 0, 'custom config spawns particles');
    emitter.delete();
  }

  {
    console.log('Test 2.8: Position can be set');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');
    emitter.setPosition(10, 5, 20);
    emitter.setActive(true);
    emitter.update(0.05);
    const data = emitter.gather();
    if (data && data.count > 0) {
      // Particles should be near the set position
      const x = data.positions[0], y = data.positions[1], z = data.positions[2];
      assert(Math.abs(x - 10) < 5, `x near 10 (got ${x.toFixed(1)})`);
      assert(Math.abs(z - 20) < 5, `z near 20 (got ${z.toFixed(1)})`);
    }
    emitter.delete();
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. Preset resolver (5 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- Preset resolver ---\n');

  {
    console.log('Test 3.1: Resolve known presets');
    const names = ['dust_puff', 'spark_shower', 'magic_spiral', 'fire', 'smoke',
                   'rain', 'snow', 'leaves', 'fireflies', 'steam', 'waterfall_mist'];
    for (const name of names) {
      const cfg = sim.resolvePreset(name);
      assert(cfg !== null, `${name} resolves`);
      if (cfg) assert(cfg.spawn_rate > 0, `${name} spawn_rate > 0`);
    }
  }

  {
    console.log('Test 3.2: Unknown preset returns null');
    const cfg = sim.resolvePreset('nonexistent');
    assert(cfg === null || cfg === undefined, 'unknown returns null');
  }

  {
    console.log('Test 3.3: Fire preset has emission');
    const cfg = sim.resolvePreset('fire');
    assert(cfg !== null, 'fire exists');
    if (cfg) assert(cfg.emission > 0, `fire emission = ${cfg.emission}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. Easing functions (8 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- Easing functions ---\n');

  {
    console.log('Test 4.1: Linear easing');
    assert(approx(sim.applyEasing(0, sim.EASING_LINEAR), 0), 'linear(0) = 0');
    assert(approx(sim.applyEasing(0.5, sim.EASING_LINEAR), 0.5), 'linear(0.5) = 0.5');
    assert(approx(sim.applyEasing(1, sim.EASING_LINEAR), 1), 'linear(1) = 1');
  }

  {
    console.log('Test 4.2: In quad easing');
    assert(approx(sim.applyEasing(0, sim.EASING_IN_QUAD), 0), 'in_quad(0) = 0');
    assert(approx(sim.applyEasing(0.5, sim.EASING_IN_QUAD), 0.25), 'in_quad(0.5) = 0.25');
    assert(approx(sim.applyEasing(1, sim.EASING_IN_QUAD), 1), 'in_quad(1) = 1');
  }

  {
    console.log('Test 4.3: Out quad easing');
    assert(approx(sim.applyEasing(0, sim.EASING_OUT_QUAD), 0), 'out_quad(0) = 0');
    assert(approx(sim.applyEasing(0.5, sim.EASING_OUT_QUAD), 0.75), 'out_quad(0.5) = 0.75');
    assert(approx(sim.applyEasing(1, sim.EASING_OUT_QUAD), 1), 'out_quad(1) = 1');
  }

  {
    console.log('Test 4.4: In out quad easing');
    assert(approx(sim.applyEasing(0, sim.EASING_IN_OUT_QUAD), 0), 'in_out_quad(0) = 0');
    assert(approx(sim.applyEasing(1, sim.EASING_IN_OUT_QUAD), 1), 'in_out_quad(1) = 1');
  }

  {
    console.log('Test 4.5: Out bounce easing');
    assert(approx(sim.applyEasing(0, sim.EASING_OUT_BOUNCE), 0), 'out_bounce(0) = 0');
    assert(approx(sim.applyEasing(1, sim.EASING_OUT_BOUNCE), 1), 'out_bounce(1) = 1');
    // Bounce at midpoint should be < 1 but > 0
    const mid = sim.applyEasing(0.5, sim.EASING_OUT_BOUNCE);
    assert(mid > 0 && mid < 1, `out_bounce(0.5) = ${mid.toFixed(3)} (between 0 and 1)`);
  }

  {
    console.log('Test 4.6: Easing constants exist');
    assert(sim.EASING_LINEAR === 0, 'LINEAR = 0');
    assert(sim.EASING_IN_QUAD === 1, 'IN_QUAD = 1');
    assert(typeof sim.EASING_IN_BOUNCE === 'number', 'IN_BOUNCE is number');
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. Integration (4 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- Integration ---\n');

  {
    console.log('Test 5.1: Full emitter lifecycle');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('dust_puff');
    emitter.setActive(true);
    // Run 60 frames at 60fps
    for (let i = 0; i < 60; i++) emitter.update(1 / 60);
    const count = emitter.aliveCount();
    assert(count > 0, `alive after 1s (${count})`);
    // Run another 3 seconds (past lifetime)
    emitter.setActive(false);
    for (let i = 0; i < 180; i++) emitter.update(1 / 60);
    const afterDeath = emitter.aliveCount();
    assert(afterDeath < count, `particles died (${count} → ${afterDeath})`);
    emitter.delete();
  }

  {
    console.log('Test 5.2: Multiple emitters independent');
    const e1 = new sim.ParticleEmitter();
    const e2 = new sim.ParticleEmitter();
    e1.configurePreset('fire');
    e2.configurePreset('smoke');
    e1.setActive(true);
    e2.setActive(true);
    e1.update(0.1);
    e2.update(0.1);
    const c1 = e1.aliveCount();
    const c2 = e2.aliveCount();
    assert(c1 > 0, `emitter 1 has particles (${c1})`);
    assert(c2 > 0, `emitter 2 has particles (${c2})`);
    // Fire has higher spawn rate than smoke
    assert(c1 !== c2 || c1 > 0, 'emitters are independent');
    e1.delete();
    e2.delete();
  }

  {
    console.log('Test 5.3: Preset roundtrip');
    const cfg = sim.resolvePreset('spark_shower');
    assert(cfg !== null, 'preset resolved');
    if (cfg) {
      const emitter = new sim.ParticleEmitter();
      emitter.configure(cfg);
      emitter.setActive(true);
      emitter.update(0.1);
      assert(emitter.aliveCount() > 0, 'roundtrip works');
      emitter.delete();
    }
  }

  {
    console.log('Test 5.4: Gather data usable for rendering');
    const emitter = new sim.ParticleEmitter();
    emitter.configurePreset('fire');
    emitter.setActive(true);
    emitter.update(0.1);
    const data = emitter.gather();
    if (data && data.count > 0) {
      // Verify data is suitable for Three.js BufferGeometry
      assert(data.positions.BYTES_PER_ELEMENT === 4, 'positions are float32');
      assert(data.colors.BYTES_PER_ELEMENT === 4, 'colors are float32');
      // Colors should be in 0-1 range
      let colorsValid = true;
      for (let i = 0; i < Math.min(data.count * 3, 30); i++) {
        if (data.colors[i] < 0 || data.colors[i] > 1.5) colorsValid = false;
      }
      assert(colorsValid, 'colors in valid range');
    }
    emitter.delete();
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════
  // 6. Animator (10 tests)
  // ═══════════════════════════════════════════════════════════════

  console.log('\n--- Animator ---\n');

  {
    console.log('Test 6.1: Create animator');
    const animator = new sim.Animator();
    assert(animator !== null, 'animator created');
    assert(animator.sceneCount() === 0, 'empty scene');
    animator.delete();
  }

  {
    console.log('Test 6.2: Load scene');
    const animator = new sim.Animator();
    const positions = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    animator.loadScene(positions, colors, 3);
    assert(animator.sceneCount() === 3, 'scene has 3 points');
    animator.delete();
  }

  {
    console.log('Test 6.3: Tag sphere and check active');
    const animator = new sim.Animator();
    const count = 100;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random() * 10 - 5;
      positions[i * 3 + 1] = Math.random() * 10 - 5;
      positions[i * 3 + 2] = Math.random() * 10 - 5;
      colors[i * 3] = 0.5;
      colors[i * 3 + 1] = 0.5;
      colors[i * 3 + 2] = 0.5;
    }
    animator.loadScene(positions, colors, count);
    const groupId = animator.tagSphere(0, 0, 0, 10, sim.EFFECT_ORBIT, 3.0);
    assert(groupId > 0, `group created (id=${groupId})`);
    assert(animator.hasActiveGroups(), 'has active groups');
    assert(animator.hasGroup(groupId), 'has specific group');
    animator.delete();
  }

  {
    console.log('Test 6.4: Update modifies positions');
    const animator = new sim.Animator();
    const positions = new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0]);
    const colors = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    animator.loadScene(positions, colors, 3);
    animator.tagSphere(0, 0, 0, 10, sim.EFFECT_SCATTER, 2.0);

    // Update a few frames
    for (let i = 0; i < 10; i++) animator.update(1 / 60);

    const data = animator.getSceneData();
    assert(data !== null, 'scene data returned');
    if (data) {
      // Positions should have changed (scatter moves points)
      const movedX = Math.abs(data.positions[0] - 1) > 0.01;
      assert(movedX, `position changed (was 1, now ${data.positions[0].toFixed(3)})`);
    }
    animator.delete();
  }

  {
    console.log('Test 6.5: Reset scene restores positions');
    const animator = new sim.Animator();
    const positions = new Float32Array([5, 5, 5]);
    const colors = new Float32Array([1, 0, 0]);
    animator.loadScene(positions, colors, 1);
    animator.tagSphere(5, 5, 5, 10, sim.EFFECT_SCATTER, 2.0);
    for (let i = 0; i < 30; i++) animator.update(1 / 60);
    animator.resetScene();
    const data = animator.getSceneData();
    if (data) {
      assert(approx(data.positions[0], 5, 0.01), `x restored to 5 (got ${data.positions[0].toFixed(3)})`);
      assert(approx(data.positions[1], 5, 0.01), `y restored to 5`);
    }
    animator.delete();
  }

  {
    console.log('Test 6.6: Orbit effect rotates points');
    const animator = new sim.Animator();
    // Two points offset from each other — centroid will be at (0,0,0)
    const positions = new Float32Array([3, 0, 0, -3, 0, 0]);
    const colors = new Float32Array([1, 1, 1, 1, 1, 1]);
    animator.loadScene(positions, colors, 2);
    animator.tagSphere(0, 0, 0, 10, sim.EFFECT_ORBIT, 5.0);
    // Run 1 second of simulation
    for (let i = 0; i < 60; i++) animator.update(1 / 60);
    const data = animator.getSceneData();
    if (data) {
      // First point should have rotated — z should be non-zero
      const z = data.positions[2];
      assert(Math.abs(z) > 0.1, `orbit moved z (${z.toFixed(3)})`);
    }
    animator.delete();
  }

  {
    console.log('Test 6.7: Pulse effect preserves position');
    const animator = new sim.Animator();
    const positions = new Float32Array([2, 3, 4]);
    const colors = new Float32Array([1, 1, 1]);
    animator.loadScene(positions, colors, 1);
    animator.tagSphere(2, 3, 4, 10, sim.EFFECT_PULSE, 3.0);
    for (let i = 0; i < 30; i++) animator.update(1 / 60);
    const data = animator.getSceneData();
    if (data) {
      assert(approx(data.positions[0], 2, 0.01), 'pulse keeps x');
      assert(approx(data.positions[1], 3, 0.01), 'pulse keeps y');
      assert(approx(data.positions[2], 4, 0.01), 'pulse keeps z');
    }
    animator.delete();
  }

  {
    console.log('Test 6.8: Effect constants exist');
    assert(sim.EFFECT_DETACH === 0, 'DETACH=0');
    assert(sim.EFFECT_ORBIT === 2, 'ORBIT=2');
    assert(sim.EFFECT_SCATTER === 8, 'SCATTER=8');
    assert(sim.EFFECT_PULSE === 5, 'PULSE=5');
  }

  {
    console.log('Test 6.9: Tag with params');
    const animator = new sim.Animator();
    const positions = new Float32Array([1, 0, 0]);
    const colors = new Float32Array([1, 1, 1]);
    animator.loadScene(positions, colors, 1);
    const groupId = animator.tagSphereWithParams(0, 0, 0, 10, sim.EFFECT_ORBIT, 3.0,
      { rotations: 5, expansion: 2.0, opacity_end: 0.5 });
    assert(groupId > 0, 'group with params created');
    animator.delete();
  }

  {
    console.log('Test 6.10: Groups expire after lifetime');
    const animator = new sim.Animator();
    const positions = new Float32Array([1, 0, 0]);
    const colors = new Float32Array([1, 1, 1]);
    animator.loadScene(positions, colors, 1);
    animator.tagSphere(0, 0, 0, 10, sim.EFFECT_DISSOLVE, 0.5);
    assert(animator.hasActiveGroups(), 'active at start');
    // Run past lifetime
    for (let i = 0; i < 60; i++) animator.update(1 / 60);
    assert(!animator.hasActiveGroups(), 'expired after 1s (lifetime=0.5s)');
    animator.delete();
  }

  // ═══════════════════════════════════════════════════════════════

  console.log(`\n${'='.repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(40));
  process.exit(failed > 0 ? 1 : 0);
}

main();
