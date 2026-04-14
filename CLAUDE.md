## UI Implementation Checklist

After creating or modifying any UI component, verify ALL of the following before marking the task complete:

### React (Bricklayer / Echidna / Méliès)
1. New component is imported in its parent
2. New component is rendered in JSX (not just imported)
3. Component is listed in `expected-components.json` for the relevant app/mode
4. Build succeeds (`pnpm build` in tools/)
5. Run component registry health check via Chrome MCP — no missing components:
   ```javascript
   JSON.stringify(window.__COMPONENT_REGISTRY__.health())
   ```
6. Read browser console — no React errors
7. Run role-specific scenarios: `python3 scripts/scenario_runner.py --role <role>`

### Staging (C++ ImGui)
1. New panel/widget has a draw call in `staging_state.cpp`
2. Panel is registered in the View menu toggle
3. Build succeeds (`cmake --build --preset macos-debug`)
4. Run `visual_state` via Game Director — new element appears:
   ```bash
   python3 scripts/game_director.py visual_state
   ```
5. Run snapshot diff — only intended changes present:
   ```bash
   python3 scripts/game_director.py snapshot save before
   # ... make change ...
   python3 scripts/game_director.py snapshot diff before
   ```

### Cross-App (Bricklayer to Staging)
1. Data created in Bricklayer reaches Staging via "Open in Staging"
2. Run relevant role scenario: `python3 scripts/scenario_runner.py --role level-designer`

## Subrepository Architecture Rules

GSeurat is a generic engine designed to be used as a Git submodule. Follow these rules:

- **DO NOT** hardcode game-specific logic, behaviors, or absolute asset paths into `src/engine/`.
- The engine must receive asset paths (engine assets vs. game assets) from the parent application dynamically via `set_project_root()` or constructor/config parameters.
- Game-specific content (assets, world definitions, demo code) lives under `examples/island_demo/`. The `src/engine/` directory must remain game-agnostic.
- When included as a subdirectory (`add_subdirectory()`), only the core engine library (`gseurat_core`) and shaders are built. Demo, staging, and test targets are gated behind `GSEURAT_BUILD_EXAMPLES` and `GSEURAT_BUILD_TESTS` options.
- Runtime asset paths use `"assets/..."` relative to the working directory. The CMake `sync_assets` target copies from `examples/island_demo/assets/` into the build directory for standalone builds. Parent projects are responsible for providing their own assets at the expected paths.
- GSeurat is built as a static library (`STATIC`) by default when included via `add_subdirectory`. This ensures optimal performance (enabling LTO) and strictly avoids DLL boundary/memory-heap issues across Windows, Mac, and Linux. Set `GSEURAT_SHARED_LIBS=ON` only if you explicitly need a shared library.
