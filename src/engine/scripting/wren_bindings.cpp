#include "gseurat/engine/scripting/wren_bindings.hpp"
#include "gseurat/engine/app_base.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/game/components.hpp"

#define GLFW_INCLUDE_VULKAN
#include <GLFW/glfw3.h>

#include <cstring>
#include <string>

namespace gseurat {

// Helper to get the App pointer from Wren VM user data.
static AppBase* get_app(::WrenVM* vm) {
    auto* wrapper = static_cast<WrenVM*>(wrenGetUserData(vm));
    return wrapper ? wrapper->app() : nullptr;
}

// --- Engine.get_position(entity_id) ---
// Returns a list [x, y, z] for the given entity ID.
static void engine_get_position(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    uint32_t id = static_cast<uint32_t>(wrenGetSlotDouble(vm, 1));
    ecs::Entity e{id};
    auto* tf = app->world().try_get<ecs::Transform>(e);
    if (!tf) {
        wrenSetSlotNull(vm, 0);
        return;
    }

    wrenEnsureSlots(vm, 2);
    wrenSetSlotNewList(vm, 0);

    wrenSetSlotDouble(vm, 1, static_cast<double>(tf->position.x));
    wrenInsertInList(vm, 0, -1, 1);
    wrenSetSlotDouble(vm, 1, static_cast<double>(tf->position.y));
    wrenInsertInList(vm, 0, -1, 1);
    wrenSetSlotDouble(vm, 1, static_cast<double>(tf->position.z));
    wrenInsertInList(vm, 0, -1, 1);
}

// --- Engine.set_position(entity_id, x, y, z) ---
static void engine_set_position(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    uint32_t id = static_cast<uint32_t>(wrenGetSlotDouble(vm, 1));
    float x = static_cast<float>(wrenGetSlotDouble(vm, 2));
    float y = static_cast<float>(wrenGetSlotDouble(vm, 3));
    float z = static_cast<float>(wrenGetSlotDouble(vm, 4));

    ecs::Entity e{id};
    auto* tf = app->world().try_get<ecs::Transform>(e);
    if (tf) {
        tf->position = {x, y, z};
    }
}

// --- Engine.get_facing(entity_id) ---
// Returns facing direction as a string: "up", "down", "left", "right".
static void engine_get_facing(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    uint32_t id = static_cast<uint32_t>(wrenGetSlotDouble(vm, 1));
    ecs::Entity e{id};
    auto* facing = app->world().try_get<ecs::Facing>(e);
    if (!facing) {
        wrenSetSlotString(vm, 0, "down");
        return;
    }

    wrenSetSlotString(vm, 0, direction_suffix(facing->dir));
}

// --- Engine.set_facing(entity_id, direction_string) ---
static void engine_set_facing(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    uint32_t id = static_cast<uint32_t>(wrenGetSlotDouble(vm, 1));
    const char* dir_str = wrenGetSlotString(vm, 2);

    ecs::Entity e{id};
    auto* facing = app->world().try_get<ecs::Facing>(e);
    if (facing) {
        if (std::strcmp(dir_str, "up") == 0)         facing->dir = Direction::Up;
        else if (std::strcmp(dir_str, "down") == 0)  facing->dir = Direction::Down;
        else if (std::strcmp(dir_str, "left") == 0)  facing->dir = Direction::Left;
        else if (std::strcmp(dir_str, "right") == 0) facing->dir = Direction::Right;
    }
}

// --- Engine.is_key_down(key_code) ---
static void engine_is_key_down(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) {
        wrenSetSlotBool(vm, 0, false);
        return;
    }

    int key = static_cast<int>(wrenGetSlotDouble(vm, 1));
    wrenSetSlotBool(vm, 0, app->input().is_key_down(key));
}

// --- Engine.play_sound(sound_name) ---
static void engine_play_sound(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    const char* name = wrenGetSlotString(vm, 1);

    if (std::strcmp(name, "footstep") == 0)      app->audio().play(SoundId::Footstep);
    else if (std::strcmp(name, "dialog_open") == 0)  app->audio().play(SoundId::DialogOpen);
    else if (std::strcmp(name, "dialog_close") == 0) app->audio().play(SoundId::DialogClose);
    else if (std::strcmp(name, "dialog_blip") == 0)  app->audio().play(SoundId::DialogBlip);
}

// --- Engine.get_flag(name) ---
static void engine_get_flag(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) {
        wrenSetSlotBool(vm, 0, false);
        return;
    }

    const char* name = wrenGetSlotString(vm, 1);
    auto& flags = app->game_flags();
    auto it = flags.find(name);
    wrenSetSlotBool(vm, 0, it != flags.end() && it->second);
}

// --- Engine.set_flag(name, value) ---
static void engine_set_flag(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;

    const char* name = wrenGetSlotString(vm, 1);
    bool value = wrenGetSlotBool(vm, 2);
    app->game_flags()[name] = value;
}

// --- Engine.get_dt() ---
// Script system sets this each frame before calling update.
static float s_current_dt = 0.0f;

static void engine_get_dt(::WrenVM* vm) {
    wrenSetSlotDouble(vm, 0, static_cast<double>(s_current_dt));
}

void set_script_dt(float dt) {
    s_current_dt = dt;
}

// --- Engine.log(message) ---
static void engine_log(::WrenVM* vm) {
    const char* msg = wrenGetSlotString(vm, 1);
    std::printf("[wren] %s\n", msg);
}

// --- Engine.player_id() ---
static void engine_player_id(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) {
        wrenSetSlotDouble(vm, 0, 0);
        return;
    }
    wrenSetSlotDouble(vm, 0, static_cast<double>(app->player_id().id));
}

// --- Engine.npc_ids() ---
static void engine_npc_ids(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) {
        wrenSetSlotNewList(vm, 0);
        return;
    }

    wrenEnsureSlots(vm, 2);
    wrenSetSlotNewList(vm, 0);
    for (auto npc : app->npc_ids()) {
        wrenSetSlotDouble(vm, 1, static_cast<double>(npc.id));
        wrenInsertInList(vm, 0, -1, 1);
    }
}

// --- Day/Night ---
static void engine_get_time_of_day(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) {
        wrenSetSlotDouble(vm, 0, 0.0);
        return;
    }
    wrenSetSlotDouble(vm, 0, static_cast<double>(app->day_night_system().time_of_day()));
}

static void engine_set_time_of_day(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float t = static_cast<float>(wrenGetSlotDouble(vm, 1));
    app->day_night_system().set_time_of_day(t);
}

// --- Camera & Screen Effects ---
static void engine_camera_shake_1(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float amp = static_cast<float>(wrenGetSlotDouble(vm, 1));
    app->renderer().camera().trigger_shake(amp);
}

static void engine_camera_shake_3(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float amp = static_cast<float>(wrenGetSlotDouble(vm, 1));
    float freq = static_cast<float>(wrenGetSlotDouble(vm, 2));
    float dur = static_cast<float>(wrenGetSlotDouble(vm, 3));
    app->renderer().camera().trigger_shake(amp, freq, dur);
}

static void engine_camera_zoom(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float z = static_cast<float>(wrenGetSlotDouble(vm, 1));
    app->renderer().camera().set_target_zoom(z);
}

static void engine_screen_flash(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float r = static_cast<float>(wrenGetSlotDouble(vm, 1));
    float g = static_cast<float>(wrenGetSlotDouble(vm, 2));
    float b = static_cast<float>(wrenGetSlotDouble(vm, 3));
    float dur = static_cast<float>(wrenGetSlotDouble(vm, 4));
    app->screen_effects().trigger_flash({r, g, b}, dur);
}

static void engine_chromatic_aberration(::WrenVM* vm) {
    AppBase* app = get_app(vm);
    if (!app) return;
    float intensity = static_cast<float>(wrenGetSlotDouble(vm, 1));
    float dur = static_cast<float>(wrenGetSlotDouble(vm, 2));
    app->screen_effects().trigger_chromatic_pulse(intensity, dur);
}

// Binding dispatch.
void register_wren_bindings(WrenVM& wren_vm) {
    wren_vm.set_bind_foreign_method(
        [](const char* /*module*/, const char* className,
           bool isStatic, const char* signature) -> WrenForeignMethodFn {

            if (std::strcmp(className, "Engine") != 0) return nullptr;
            if (!isStatic) return nullptr;

            if (std::strcmp(signature, "get_position(_)") == 0)       return &engine_get_position;
            if (std::strcmp(signature, "set_position(_,_,_,_)") == 0) return &engine_set_position;
            if (std::strcmp(signature, "get_facing(_)") == 0)         return &engine_get_facing;
            if (std::strcmp(signature, "set_facing(_,_)") == 0)       return &engine_set_facing;
            if (std::strcmp(signature, "is_key_down(_)") == 0)        return &engine_is_key_down;
            if (std::strcmp(signature, "play_sound(_)") == 0)         return &engine_play_sound;
            if (std::strcmp(signature, "get_flag(_)") == 0)           return &engine_get_flag;
            if (std::strcmp(signature, "set_flag(_,_)") == 0)         return &engine_set_flag;
            if (std::strcmp(signature, "get_dt()") == 0)              return &engine_get_dt;
            if (std::strcmp(signature, "log(_)") == 0)                return &engine_log;
            if (std::strcmp(signature, "player_id()") == 0)           return &engine_player_id;
            if (std::strcmp(signature, "npc_ids()") == 0)             return &engine_npc_ids;
            if (std::strcmp(signature, "camera_shake(_)") == 0)       return &engine_camera_shake_1;
            if (std::strcmp(signature, "camera_shake(_,_,_)") == 0)   return &engine_camera_shake_3;
            if (std::strcmp(signature, "camera_zoom(_)") == 0)        return &engine_camera_zoom;
            if (std::strcmp(signature, "screen_flash(_,_,_,_)") == 0) return &engine_screen_flash;
            if (std::strcmp(signature, "chromatic_aberration(_,_)") == 0) return &engine_chromatic_aberration;
            if (std::strcmp(signature, "get_time_of_day()") == 0)      return &engine_get_time_of_day;
            if (std::strcmp(signature, "set_time_of_day(_)") == 0)     return &engine_set_time_of_day;

            return nullptr;
        });
}

}  // namespace gseurat
