#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/project_root.hpp"
#include "backend/miniaudio_device.hpp"
#include "mixer.hpp"
#include "metadata_loader.hpp"
#include "state_variable_filter.hpp"
#include "gseurat/engine/audio/memory_audio_source.hpp"
#include "gseurat/engine/audio/mmap_audio_source.hpp"
#include "streaming_audio_source.hpp"
#include "audio_stream_manager.hpp"

#include <cassert>
#include <cmath>
#include <fstream>

namespace gseurat::audio {

namespace {

static std::expected<std::unique_ptr<IAudioSource>, LoadError>
load_audio_source(std::string_view path, uint32_t sample_rate,
                   AudioStreamManager* stream_mgr = nullptr,
                   uint64_t loop_start = 0, uint64_t loop_end = 0) {
    std::ifstream f(std::string(path), std::ios::binary);
    if (!f) return std::unexpected(LoadError::FileNotFound);
    char magic[4]{};
    f.read(magic, 4);
    f.close();

    if (magic[0] == 'G' && magic[1] == 'S' && magic[2] == 'A' && magic[3] == 'U') {
        return MmapAudioSource::from_gsaudio_file(path, sample_rate);
    }
    if (magic[0] == 'O' && magic[1] == 'g' && magic[2] == 'g' && magic[3] == 'S') {
        if (stream_mgr) {
            return StreamingAudioSource::create(path, sample_rate,
                                                 loop_start, loop_end, stream_mgr);
        }
    }
    return MemoryAudioSource::from_wav_file(path, sample_rate);
}

class AudioEngineImpl final : public AudioEngine {
public:
    AudioEngineImpl(Config cfg, Mode mode)
        : cfg_(cfg), mode_(mode), channels_(2),
          mixer_(cfg.sample_rate, channels_, cfg.buffer_frames, cfg.max_active_groups, cfg.max_oneshot_voices) {
        mixer_.set_sfx_registry(&sfx_registry_);
        if (mode_ == Mode::Realtime) {
            device_ = make_miniaudio_device();
            device_->start(cfg_.sample_rate, channels_, cfg_.buffer_frames,
                [this](float* out, uint32_t frames) {
                    std::span<float> buf{out, static_cast<size_t>(frames) * channels_};
                    mixer_.render(buf, frames);
                });
        }
    }

    ~AudioEngineImpl() override {
        if (device_) device_->stop();
    }

    std::expected<uint32_t, LoadTrackGroupError>
    load_track_group(std::string_view config_path) override {
        auto cfg_r = load_music_config(config_path);
        if (!cfg_r) return std::unexpected(LoadTrackGroupError::ParseFailed);
        auto& cfg = cfg_r.value();
        if (cfg.sample_rate != cfg_.sample_rate) {
            return std::unexpected(LoadTrackGroupError::SampleRateMismatch);
        }
        uint32_t first_id = 0;
        for (auto& tg : cfg.track_groups) {
            std::vector<std::unique_ptr<IAudioSource>> stems;
            stems.reserve(tg.stems.size());
            for (const auto& s : tg.stems) {
                // Resolve relative stem paths using project root
                auto stem_path = resolve_asset_path(s.source_path).string();
                auto src_r = load_audio_source(stem_path, cfg.sample_rate,
                                                &stream_manager_, tg.loop_start, tg.loop_end);
                if (!src_r) {
                    std::fprintf(stderr, "[audio] Failed to load stem: %s\n", stem_path.c_str());
                    return std::unexpected(LoadTrackGroupError::StemLoadFailed);
                }
                stems.push_back(std::move(src_r.value()));
            }
            const uint32_t id = tg.id;
            if (first_id == 0) first_id = id;
            mixer_.register_track_group(id, std::move(tg), std::move(stems));
        }
        return first_id;
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
        mixer_.add_rtpc_binding(b);
    }

    std::expected<uint32_t, SfxLoadError> load_sfx(std::string_view wav_path) override {
        auto src = load_audio_source(wav_path, cfg_.sample_rate);
        if (!src) return std::unexpected(SfxLoadError::DecodeFailed);
        const uint32_t id = static_cast<uint32_t>(sfx_registry_.size());
        sfx_registry_.push_back(std::move(src.value()));
        return id;
    }

    void play_oneshot(uint32_t sfx_id, float volume) override {
        AudioCommand c{};
        c.type = AudioCommand::Type::PlayOneshot;
        c.stem_index = sfx_id;
        c.value = volume;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void play_looping_spatial(uint32_t sfx_id, float px, float py, float pz,
                               float max_dist, float volume) override {
        AudioCommand c{};
        c.type = AudioCommand::Type::PlayLoopingSpatial;
        c.stem_index = sfx_id;
        c.value = volume;
        c.pos[0] = px; c.pos[1] = py; c.pos[2] = pz;
        c.max_distance = max_dist;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void stop_all_sfx() override {
        AudioCommand c{};
        c.type = AudioCommand::Type::StopAllSfx;
        if (!mixer_.command_queue().try_push(c))
            mixer_.telemetry().dropped_commands.fetch_add(1, std::memory_order_relaxed);
    }

    void add_stem_effect(uint32_t group_id, uint32_t stem_index,
                          std::unique_ptr<IDSPEffect> effect) override {
        mixer_.add_stem_effect(group_id, stem_index, std::move(effect));
    }

    void bind_effect_param_to_rtpc(uint32_t group_id, uint32_t stem_index,
                                    uint32_t effect_index, uint32_t parameter_id,
                                    uint32_t rtpc_id, float min_out, float max_out) override {
        RtpcBinding b;
        b.target = RtpcBinding::Target::EffectParam;
        b.group_id = group_id;
        b.stem_index = stem_index;
        b.rtpc_id = rtpc_id;
        b.min_out = min_out;
        b.max_out = max_out;
        b.effect_index = effect_index;
        b.parameter_id = parameter_id;
        mixer_.add_rtpc_binding(b);
    }

    void set_listener_position(float x, float y, float z) override {
        mixer_.listener_state().x.store(x, std::memory_order_relaxed);
        mixer_.listener_state().y.store(y, std::memory_order_relaxed);
        mixer_.listener_state().z.store(z, std::memory_order_relaxed);
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

    DebugSnapshot build_debug_snapshot() const override {
        // NOTE: This reads Mixer state without synchronization. The audio
        // callback thread may be mid-render, so values can be slightly stale
        // or torn. This is acceptable for a debug dump — worst case is a
        // briefly incorrect volume display. See debug_dump_ears.hpp header.
        DebugSnapshot snap;
        snap.master_volume = 1.0f;
        snap.sample_rate = cfg_.sample_rate;
        snap.max_polyphony = cfg_.max_oneshot_voices;
        snap.dropped_commands = const_cast<Mixer&>(mixer_).telemetry().dropped_commands.load(
            std::memory_order_relaxed);

        const auto& active = mixer_.active_groups();
        const auto& registry = mixer_.registry();

        uint32_t active_count = 0;
        for (const auto& g : active) {
            if (g.status == TrackGroupState::Status::Idle) continue;
            ++active_count;

            DebugGroupInfo info;
            info.group_id = g.group_id;
            info.status = static_cast<uint8_t>(g.status);
            info.play_cursor = g.play_cursor;
            info.group_volume = g.group_volume.current();
            info.stem_count = g.stem_count;

            // Find registry entry for source paths
            const TrackGroupRegistryEntry* reg_entry = nullptr;
            for (const auto& r : registry) {
                if (r.metadata.id == g.group_id) { reg_entry = &r; break; }
            }

            for (uint8_t i = 0; i < g.stem_count; ++i) {
                DebugGroupInfo::StemInfo si;
                si.volume = g.stems[i].volume.current();
                if (reg_entry && i < reg_entry->metadata.stems.size()) {
                    si.source_path = reg_entry->metadata.stems[i].source_path;
                }
                info.stems.push_back(std::move(si));
            }
            snap.groups.push_back(std::move(info));
        }
        snap.active_group_count = active_count;
        return snap;
    }

private:
    uint64_t ms_to_frames(float ms) const noexcept {
        return static_cast<uint64_t>(std::llround(
            static_cast<double>(ms) * static_cast<double>(cfg_.sample_rate) / 1000.0));
    }

    Config   cfg_;
    Mode     mode_;
    uint32_t channels_;
    std::vector<std::unique_ptr<IAudioSource>> sfx_registry_;
    AudioStreamManager stream_manager_;
    Mixer    mixer_;
    std::unique_ptr<IAudioDevice> device_;
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

std::unique_ptr<IDSPEffect> AudioEngine::create_svf(
    float sample_rate, uint8_t type, float cutoff_hz, float resonance) {
    return std::make_unique<StateVariableFilter>(
        sample_rate, static_cast<StateVariableFilter::Type>(type),
        cutoff_hz, resonance);
}

}  // namespace gseurat::audio
