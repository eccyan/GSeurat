#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include "vulkan_game/engine/audio_system.hpp"

#include <algorithm>
#include <cmath>

namespace vulkan_game {

namespace {

// State volume presets: [BassDrone, HarmonyPad, Melody, Percussion]
constexpr std::array<float, 4> kExploreVolumes  = {0.8f, 0.5f, 0.0f, 0.0f};
constexpr std::array<float, 4> kNearNPCVolumes  = {0.8f, 0.2f, 0.7f, 0.0f};
constexpr std::array<float, 4> kDialogVolumes   = {0.4f, 0.0f, 0.0f, 0.0f};

}  // namespace

bool AudioSystem::load_sound(const std::string& path, SoundSlot& slot, bool spatial, bool looping) {
    uint32_t flags = 0;
    if (spatial) {
        flags |= MA_SOUND_FLAG_NO_SPATIALIZATION;
        flags = 0;  // we want spatialization for spatial sounds
    } else {
        flags |= MA_SOUND_FLAG_NO_SPATIALIZATION;
    }

    ma_result result = ma_sound_init_from_file(&engine_, path.c_str(), flags, nullptr, nullptr, &slot.sound);
    if (result != MA_SUCCESS) {
        return false;
    }

    if (spatial) {
        ma_sound_set_spatialization_enabled(&slot.sound, MA_TRUE);
        ma_sound_set_min_distance(&slot.sound, 1.0f);
        ma_sound_set_max_distance(&slot.sound, 15.0f);
        ma_sound_set_attenuation_model(&slot.sound, ma_attenuation_model_inverse);
    }

    if (looping) {
        ma_sound_set_looping(&slot.sound, MA_TRUE);
    }

    slot.initialized = true;
    return true;
}

bool AudioSystem::init(const std::string& asset_dir) {
    ma_engine_config config = ma_engine_config_init();
    ma_result result = ma_engine_init(&config, &engine_);
    if (result != MA_SUCCESS) {
        return false;
    }
    engine_initialized_ = true;

    std::string audio_dir = asset_dir + "/audio/";

    // Load SFX
    const char* sfx_files[] = {
        "torch_crackle.wav",
        "footstep.wav",
        "dialog_open.wav",
        "dialog_close.wav",
        "dialog_blip.wav"
    };
    for (uint32_t i = 0; i < static_cast<uint32_t>(SoundId::Count); ++i) {
        load_sound(audio_dir + sfx_files[i], sounds_[i], false, false);
    }

    // Load 4 spatial torch crackle instances
    for (uint32_t i = 0; i < kTorchCount; ++i) {
        load_sound(audio_dir + "torch_crackle.wav", torch_sounds_[i], true, true);
        if (torch_sounds_[i].initialized) {
            ma_sound_set_volume(&torch_sounds_[i].sound, 0.15f);
            ma_sound_start(&torch_sounds_[i].sound);
        }
    }

    // Load music layers
    const char* music_files[] = {
        "music_bass.wav",
        "music_harmony.wav",
        "music_melody.wav",
        "music_percussion.wav"
    };
    for (uint32_t i = 0; i < kLayerCount; ++i) {
        load_sound(audio_dir + music_files[i], music_layers_[i], false, true);
    }

    // Set initial state volumes and start all layers
    apply_state_volumes();
    for (uint32_t i = 0; i < kLayerCount; ++i) {
        music_current_volumes_[i] = music_target_volumes_[i];
        if (music_layers_[i].initialized) {
            ma_sound_set_volume(&music_layers_[i].sound, music_current_volumes_[i]);
            ma_sound_start(&music_layers_[i].sound);
        }
    }

    return true;
}

void AudioSystem::shutdown() {
    for (auto& slot : sounds_) {
        if (slot.initialized) {
            ma_sound_uninit(&slot.sound);
            slot.initialized = false;
        }
    }
    for (auto& slot : torch_sounds_) {
        if (slot.initialized) {
            ma_sound_uninit(&slot.sound);
            slot.initialized = false;
        }
    }
    for (auto& slot : music_layers_) {
        if (slot.initialized) {
            ma_sound_uninit(&slot.sound);
            slot.initialized = false;
        }
    }
    if (engine_initialized_) {
        ma_engine_uninit(&engine_);
        engine_initialized_ = false;
    }
}

void AudioSystem::update(float dt) {
    update_layer_volumes(dt);
}

void AudioSystem::play(SoundId id) {
    auto idx = static_cast<size_t>(id);
    if (idx < sounds_.size() && sounds_[idx].initialized) {
        ma_sound_seek_to_pcm_frame(&sounds_[idx].sound, 0);
        ma_sound_start(&sounds_[idx].sound);
    }
}

void AudioSystem::stop(SoundId id) {
    auto idx = static_cast<size_t>(id);
    if (idx < sounds_.size() && sounds_[idx].initialized) {
        ma_sound_stop(&sounds_[idx].sound);
    }
}

void AudioSystem::set_music_state(MusicState state) {
    if (state != current_state_) {
        current_state_ = state;
        apply_state_volumes();
    }
}

void AudioSystem::set_npc_proximity(float normalized) {
    npc_proximity_ = std::clamp(normalized, 0.0f, 1.0f);
}

void AudioSystem::set_player_speed(float normalized) {
    player_speed_ = std::clamp(normalized, 0.0f, 1.0f);
}

void AudioSystem::set_torch_position(uint32_t index, glm::vec3 pos) {
    if (index < kTorchCount && torch_sounds_[index].initialized) {
        ma_sound_set_position(&torch_sounds_[index].sound, pos.x, pos.y, pos.z);
    }
}

void AudioSystem::set_listener(glm::vec3 pos, glm::vec3 forward, glm::vec3 up) {
    if (!engine_initialized_) return;
    ma_engine_listener_set_position(&engine_, 0, pos.x, pos.y, pos.z);
    ma_engine_listener_set_direction(&engine_, 0, forward.x, forward.y, forward.z);
    ma_engine_listener_set_world_up(&engine_, 0, up.x, up.y, up.z);
}

void AudioSystem::apply_state_volumes() {
    switch (current_state_) {
        case MusicState::Explore:
            music_target_volumes_ = kExploreVolumes;
            break;
        case MusicState::NearNPC:
            music_target_volumes_ = kNearNPCVolumes;
            break;
        case MusicState::Dialog:
            music_target_volumes_ = kDialogVolumes;
            break;
    }
}

void AudioSystem::update_layer_volumes(float dt) {
    // Apply dynamic modifiers on top of state presets
    apply_state_volumes();

    // Melody boosted by NPC proximity
    auto melody_idx = static_cast<size_t>(MusicLayer::Melody);
    music_target_volumes_[melody_idx] = std::clamp(
        music_target_volumes_[melody_idx] + npc_proximity_ * 0.3f, 0.0f, 1.0f);

    // Percussion boosted by player speed
    auto perc_idx = static_cast<size_t>(MusicLayer::Percussion);
    music_target_volumes_[perc_idx] = std::clamp(
        music_target_volumes_[perc_idx] + player_speed_ * 0.5f, 0.0f, 1.0f);

    // Exponential lerp towards targets
    float factor = 1.0f - std::exp(-kCrossfadeSpeed * dt);
    for (uint32_t i = 0; i < kLayerCount; ++i) {
        music_current_volumes_[i] += (music_target_volumes_[i] - music_current_volumes_[i]) * factor;

        if (music_layers_[i].initialized) {
            ma_sound_set_volume(&music_layers_[i].sound, music_current_volumes_[i]);
        }
    }
}

}  // namespace vulkan_game
