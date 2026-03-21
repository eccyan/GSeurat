#include "vulkan_game/engine/scripting/script_system.hpp"
#include "vulkan_game/engine/app_base.hpp"
#include "vulkan_game/engine/ecs/default_components.hpp"
#include "vulkan_game/game/components.hpp"

#include <cstdio>

namespace vulkan_game {

void ScriptSystem::init(AppBase* app, WrenVM* wren_vm) {
    app_ = app;
    wren_vm_ = wren_vm;
}

void ScriptSystem::update(float dt) {
    if (!wren_vm_ || !wren_vm_->vm()) return;

    set_script_dt(dt);

    // Iterate all entities with ScriptRef and call their update method.
    app_->world().view<ecs::ScriptRef>().each(
        [&](ecs::Entity e, ecs::ScriptRef& ref) {
            // The Wren class must have a static update(entity_id, dt) method.
            // We call: ClassName.update(entity_id, dt)
            auto* vm = wren_vm_->vm();

            // Get the class handle.
            wrenEnsureSlots(vm, 3);
            wrenGetVariable(vm, ref.module_name.c_str(), ref.class_name.c_str(), 0);

            // Set arguments: slot 1 = entity_id, slot 2 = dt.
            wrenSetSlotDouble(vm, 1, static_cast<double>(e.id));
            wrenSetSlotDouble(vm, 2, static_cast<double>(dt));

            // Call update(_,_).
            WrenHandle* method = wrenMakeCallHandle(vm, "update(_,_)");
            WrenInterpretResult result = wrenCall(vm, method);
            wrenReleaseHandle(vm, method);

            if (result != WREN_RESULT_SUCCESS) {
                std::fprintf(stderr, "ScriptSystem: failed to call %s.update on entity %u\n",
                             ref.class_name.c_str(), e.id);
            }
        });
}

void ScriptSystem::check_hot_reload() {
    if (!wren_vm_) return;
    wren_vm_->check_hot_reload();
}

}  // namespace vulkan_game
