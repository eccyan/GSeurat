#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/dsp_effect.hpp"
#include "gseurat/engine/audio/track_group.hpp"

#include <cstdint>
#include <expected>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat::audio {

enum class InitError : uint32_t {
    BadConfig,
    DeviceInitFailed,
    OutOfMemory,
};

enum class SfxLoadError : uint32_t { FileNotFound, DecodeFailed, SampleRateMismatch };

enum class LoadTrackGroupError : uint32_t {
    FileNotFound,
    ParseFailed,
    SampleRateMismatch,
    StemLoadFailed,
    TooManyGroups,
};

class AudioEngine {
public:
    struct Config {
        uint32_t sample_rate            = 48000;
        uint32_t buffer_frames          = 1024;
        uint32_t max_track_groups       = 32;
        uint32_t max_active_groups      = 8;
        uint32_t command_queue_capacity = 256;
        uint32_t rtpc_count             = 64;
        uint32_t max_oneshot_voices     = 32;
    };
    enum class Mode { Realtime, Offline };

    static std::expected<std::unique_ptr<AudioEngine>, InitError>
        create(Config cfg, Mode mode);

    virtual ~AudioEngine();

    virtual std::expected<uint32_t, LoadTrackGroupError>
        load_track_group(std::string_view config_json_path) = 0;

    virtual void play_group        (uint32_t group_id) = 0;
    virtual void stop_group        (uint32_t group_id) = 0;
    virtual void set_stem_volume   (uint32_t group_id, uint32_t stem_index,
                                     float target, float fade_ms) = 0;
    virtual void set_group_volume  (uint32_t group_id, float target, float fade_ms) = 0;
    virtual void request_transition(uint32_t from_id, uint32_t to_id, float xfade_ms) = 0;
    virtual void set_rtpc          (uint32_t rtpc_id, float value) = 0;
    virtual void bind_stem_volume_to_rtpc(
        uint32_t group_id, uint32_t stem_index,
        uint32_t rtpc_id, float min_out, float max_out) = 0;
    // SFX
    virtual std::expected<uint32_t, SfxLoadError> load_sfx(std::string_view wav_path) = 0;
    virtual void play_oneshot(uint32_t sfx_id, float volume = 1.0f) = 0;
    virtual void play_looping_spatial(uint32_t sfx_id, float pos_x, float pos_y, float pos_z,
                                      float max_distance, float volume = 1.0f) = 0;
    virtual void stop_all_sfx() = 0;
    virtual void set_listener_position(float x, float y, float z) = 0;

    // DSP effects (game thread, before play_group)
    virtual void add_stem_effect(uint32_t group_id, uint32_t stem_index,
                                  std::unique_ptr<IDSPEffect> effect) = 0;
    virtual void bind_effect_param_to_rtpc(
        uint32_t group_id, uint32_t stem_index,
        uint32_t effect_index, uint32_t parameter_id,
        uint32_t rtpc_id, float min_out, float max_out) = 0;

    // Factory for built-in effects
    static std::unique_ptr<IDSPEffect> create_svf(
        float sample_rate,
        uint8_t type = 0,  // 0=LPF, 1=HPF, 2=BPF
        float cutoff_hz = 20000.0f,
        float resonance = 0.707f);

    virtual void render_offline(std::span<float> interleaved_out, uint64_t num_frames) = 0;

    virtual uint64_t current_frame()              const noexcept = 0;
    virtual bool     is_group_playing(uint32_t)   const noexcept = 0;
    virtual uint32_t dropped_command_count()      const noexcept = 0;
    virtual uint32_t channels()                   const noexcept = 0;

    // Debug snapshot — reads Mixer state for the debug dump system.
    // Returns per-group status, per-stem volumes, voice state.
    struct DebugGroupInfo {
        uint32_t    group_id    = 0;
        uint8_t     status      = 0;   // TrackGroupState::Status
        uint64_t    play_cursor = 0;
        float       group_volume = 0.0f;
        uint8_t     stem_count  = 0;
        struct StemInfo {
            float volume = 0.0f;
            std::string source_path;
        };
        std::vector<StemInfo> stems;
    };
    struct DebugSnapshot {
        float    master_volume      = 1.0f;
        uint32_t sample_rate        = 0;
        uint32_t max_polyphony      = 0;
        uint32_t active_voice_count = 0;
        uint32_t active_group_count = 0;
        uint32_t dropped_commands   = 0;
        std::vector<DebugGroupInfo> groups;
    };
    virtual DebugSnapshot build_debug_snapshot() const = 0;

    // Test-only: register pre-built track group without JSON loading.
    virtual uint32_t register_track_group_for_test(
        TrackGroupMetadata meta,
        std::vector<std::unique_ptr<IAudioSource>> stems) = 0;

protected:
    AudioEngine() = default;
};

}  // namespace gseurat::audio
