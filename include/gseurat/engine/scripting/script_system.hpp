#pragma once

#include "gseurat/engine/scripting/wren_vm.hpp"
#include "gseurat/engine/ecs/world.hpp"

namespace gseurat {

class AppBase;

class ScriptSystem {
public:
    void init(AppBase* app, WrenVM* wren_vm);

    // Call update(entity_id, dt) on all entities with ScriptRef.
    void update(float dt);

    // Check for script hot-reload (~1 second interval).
    void check_hot_reload();

private:
    AppBase* app_ = nullptr;
    WrenVM* wren_vm_ = nullptr;
    float reload_timer_ = 0.0f;
    static constexpr float kReloadInterval = 1.0f;
};

// Declared in wren_bindings.cpp — used by ScriptSystem to set dt before calls.
void set_script_dt(float dt);

}  // namespace gseurat
