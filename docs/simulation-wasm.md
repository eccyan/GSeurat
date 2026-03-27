# Simulation WASM — C++ Particle + Animation Engine in the Browser

The simulation WASM module compiles the GSeurat particle emitter and animation
engine to WebAssembly, providing the exact same simulation logic to web tools
(Méliès, Bricklayer) with zero code divergence from the native engine.

## Quick Start

```bash
# Prerequisites: Emscripten SDK (brew install emscripten)
cd tools/packages/simulation-wasm
bash build.sh
# Produces: dist/simulation.mjs + dist/simulation.wasm (~40KB)
```

## What's Compiled

| Source File | Lines | Contains |
|-------------|-------|----------|
| `src/engine/gs_particle.cpp` | ~400 | Emitter simulation, 11 presets |
| `src/engine/gs_animator.cpp` | ~470 | 9 animation effects, 31 easing curves |

Dependencies: GLM (header-only math). **No Vulkan, GPU, or platform code.**

## API

### ParticleEmitter

```ts
import createSimulation from '@gseurat/simulation-wasm';

const sim = await createSimulation();
const emitter = new sim.ParticleEmitter();

// Configure from preset or custom config
emitter.configurePreset('fire');
// or: emitter.configure({ spawn_rate: 80, emission: 1.5, ... });

emitter.setPosition(10, 5, 20);
emitter.setActive(true);

// Each frame:
emitter.update(dt);  // advance simulation
const data = emitter.gather();  // get renderable data
// data.positions: Float32Array [x0,y0,z0, x1,y1,z1, ...]
// data.colors:    Float32Array [r0,g0,b0, r1,g1,b1, ...]
// data.scales:    Float32Array [s0, s1, ...]
// data.opacities: Float32Array [o0, o1, ...]
// data.count:     number

emitter.delete();  // free WASM memory
```

### Preset Resolver

```ts
const config = sim.resolvePreset('fire');
// Returns EmitterConfig object or null
// 11 presets: dust_puff, spark_shower, magic_spiral, fire, smoke,
//             rain, snow, leaves, fireflies, steam, waterfall_mist
```

### Easing Functions

```ts
const value = sim.applyEasing(0.5, sim.EASING_IN_QUAD);  // 0.25
// 31 easing constants: EASING_LINEAR, EASING_IN_QUAD, ... EASING_IN_OUT_BOUNCE
```

## Three.js Integration

```ts
// In a React Three Fiber useFrame callback:
useFrame((_, dt) => {
  emitter.update(dt);
  const data = emitter.gather();
  if (data) {
    geometry.setAttribute('position',
      new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('color',
      new THREE.BufferAttribute(data.colors, 3));
  }
});
```

## Architecture

```
tools/packages/simulation-wasm/
├── bindings.cpp           # Embind wrappers (C++ → JS)
├── build.sh               # Emscripten build script
├── package.json           # @gseurat/simulation-wasm
└── dist/
    ├── simulation.mjs     # ES module loader (generated)
    ├── simulation.wasm    # WebAssembly binary (~40KB)
    └── index.d.ts         # TypeScript declarations
```

## Zero Divergence

The WASM module compiles the **exact same C++ source files** as the native engine.
When you modify `gs_particle.cpp` or `gs_animator.cpp`, rebuild the WASM module
to keep web tools in sync:

```bash
cd tools/packages/simulation-wasm && bash build.sh
```

## Tests

```bash
cd tools/tests && pnpm test:simulation-wasm
# 73 tests: module loading, emitter lifecycle, presets, easing, integration
```
