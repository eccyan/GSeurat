#pragma once

#include <array>
#include <cstdint>
#include <string>

#include <glm/glm.hpp>
#include <miniaudio.h>

namespace gseurat {

enum class SoundId : uint32_t {
    TorchCrackle = 0,
    Footstep = 1,
    DialogOpen = 2,
    DialogClose = 3,
    DialogBlip = 4,
    Count = 5
};

enum class MusicLayer : uint32_t {
    BassDrone = 0,
    HarmonyPad = 1,
    Melody = 2,
    Percussion = 3,
    Count = 4
};

enum class MusicState {
    Explore,
    NearNPC,
    Dialog
};

class AudioSystem {
public:
    bool init(const std::string& asset_dir);
    void shutdown();
    void update(float dt);

    // SFX
    void play(SoundId id);
    void stop(SoundId id);

    // Interactive music
    void set_music_state(MusicState state);
    void set_npc_proximity(float normalized);
    void set_player_speed(float normalized);

    // Spatial
    void set_torch_position(uint32_t index, glm::vec3 pos);
    void set_listener(glm::vec3 pos, glm::vec3 forward, glm::vec3 up);

    // Mute controls
    void set_music_muted(bool muted) { music_muted_ = muted; }
    void set_sfx_muted(bool muted) { sfx_muted_ = muted; }
    bool music_muted() const { return music_muted_; }
    bool sfx_muted() const { return sfx_muted_; }

private:
    struct SoundSlot {
        ma_sound sound{};
        bool initialized = false;
    };

    ma_engine engine_{};
    bool engine_initialized_ = false;

    // SFX slots
    std::array<SoundSlot, static_cast<size_t>(SoundId::Count)> sounds_{};

    // 4 spatial torch crackle instances
    static constexpr uint32_t kTorchCount = 4;
    std::array<SoundSlot, kTorchCount> torch_sounds_{};

    // Music layers (4 looping tracks)
    static constexpr uint32_t kLayerCount = static_cast<uint32_t>(MusicLayer::Count);
    std::array<SoundSlot, kLayerCount> music_layers_{};
    std::array<float, kLayerCount> music_target_volumes_{};
    std::array<float, kLayerCount> music_current_volumes_{};
    float npc_proximity_ = 0.0f;
    float player_speed_ = 0.0f;
    MusicState current_state_ = MusicState::Explore;

    static constexpr float kCrossfadeSpeed = 3.0f;
    bool music_muted_ = false;
    bool sfx_muted_ = false;

    bool load_sound(const std::string& path, SoundSlot& slot, bool spatial, bool looping);
    void apply_state_volumes();
    void update_layer_volumes(float dt);
};

}  // namespace gseurat
