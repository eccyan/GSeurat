#include "gseurat/engine/audio/audio_engine.hpp"
#include "mixer.hpp"

#include <cassert>
#include <cmath>

namespace gseurat::audio {

namespace {

class AudioEngineImpl final : public AudioEngine {
public:
    AudioEngineImpl(Config cfg, Mode mode)
        : cfg_(cfg), mode_(mode), channels_(2),
          mixer_(cfg.sample_rate, channels_, cfg.buffer_frames, cfg.max_active_groups) {}

    std::expected<uint32_t, LoadTrackGroupError>
    load_track_group(std::string_view) override {
        return std::unexpected(LoadTrackGroupError::ParseFailed);
    }

    void play_group(uint32_t gid) override {
        AudioCommand c{}; c.type = AudioCommand::Type::PlayGroup; c.group_id = gid;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void stop_group(uint32_t gid) override {
        AudioCommand c{}; c.type = AudioCommand::Type::StopGroup; c.group_id = gid;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void set_stem_volume(uint32_t gid, uint32_t si, float target, float fade_ms) override {
        AudioCommand c{}; c.type = AudioCommand::Type::SetStemVolume;
        c.group_id = gid; c.stem_index = si; c.value = target; c.frame_count = ms_to_frames(fade_ms);
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void set_group_volume(uint32_t gid, float target, float fade_ms) override {
        AudioCommand c{}; c.type = AudioCommand::Type::SetGroupVolume;
        c.group_id = gid; c.value = target; c.frame_count = ms_to_frames(fade_ms);
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void request_transition(uint32_t from, uint32_t to, float xfade_ms) override {
        AudioCommand c{}; c.type = AudioCommand::Type::RequestTransition;
        c.group_id = from; c.secondary_group_id = to; c.frame_count = ms_to_frames(xfade_ms);
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void set_rtpc(uint32_t rtpc_id, float value) override {
        if (rtpc_id < RtpcBus::kMaxRtpc)
            mixer_.rtpc_bus().values[rtpc_id].store(value, std::memory_order_relaxed);
    }

    void bind_stem_volume_to_rtpc(uint32_t gid, uint32_t si,
                                   uint32_t rtpc_id, float min_out, float max_out) override {
        RtpcBinding b;
        b.group_id = gid;
        b.stem_index = si;
        b.rtpc_id = rtpc_id;
        b.min_out = min_out;
        b.max_out = max_out;
        b.active = true;
        mixer_.add_rtpc_binding(b);
    }

    void render_offline(std::span<float> out, uint64_t num_frames) override {
        assert(mode_ == Mode::Offline);
        uint64_t done = 0;
        while (done < num_frames) {
            const uint32_t blk = static_cast<uint32_t>(
                std::min<uint64_t>(num_frames - done, cfg_.buffer_frames));
            std::span<float> slice{out.data() + done * channels_, static_cast<size_t>(blk) * channels_};
            mixer_.render(slice, blk);
            done += blk;
        }
    }

    uint64_t current_frame() const noexcept override {
        return const_cast<Mixer&>(mixer_).telemetry().current_frame.load(std::memory_order_relaxed);
    }
    bool is_group_playing(uint32_t gid) const noexcept override {
        if (gid >= 64) return false;
        return (const_cast<Mixer&>(mixer_).telemetry().active_group_bitmap.load(std::memory_order_relaxed)
                & (1ULL << gid)) != 0;
    }
    uint32_t dropped_command_count() const noexcept override {
        return const_cast<Mixer&>(mixer_).telemetry().dropped_commands.load(std::memory_order_relaxed);
    }
    uint32_t channels() const noexcept override { return channels_; }

    uint32_t register_track_group_for_test(
        TrackGroupMetadata meta,
        std::vector<std::unique_ptr<IAudioSource>> stems) override {
        const uint32_t id = meta.id;
        mixer_.register_track_group(id, std::move(meta), std::move(stems));
        return id;
    }

private:
    uint64_t ms_to_frames(float ms) const noexcept {
        return static_cast<uint64_t>(std::llround(
            static_cast<double>(ms) * static_cast<double>(cfg_.sample_rate) / 1000.0));
    }

    Config   cfg_;
    Mode     mode_;
    uint32_t channels_;
    Mixer    mixer_;
};

}  // namespace

std::expected<std::unique_ptr<AudioEngine>, InitError>
AudioEngine::create(Config cfg, Mode mode) {
    if (cfg.buffer_frames == 0 || cfg.sample_rate == 0)
        return std::unexpected(InitError::BadConfig);
    if (cfg.max_active_groups > kMaxActiveGroupsHardCap)
        return std::unexpected(InitError::BadConfig);
    return std::unique_ptr<AudioEngine>(new AudioEngineImpl(cfg, mode));
}

AudioEngine::~AudioEngine() = default;

}  // namespace gseurat::audio
