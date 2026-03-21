#pragma once

#include "vulkan_game/engine/scripting/wren_vm.hpp"

namespace vulkan_game {

class AppBase;

// Register all engine foreign methods with the WrenVM.
// Binds: Engine.get_position(_), Engine.set_position(_,_,_,_),
//        Engine.is_key_down(_), Engine.play_sound(_),
//        Engine.get_flag(_), Engine.set_flag(_,_),
//        Engine.get_dt(), Engine.log(_)
void register_wren_bindings(WrenVM& wren_vm);

}  // namespace vulkan_game
