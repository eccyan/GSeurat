#pragma once
#include "gseurat/engine/audio/command_queue.hpp"
#include "gseurat/engine/audio/audio_source.hpp"
#include "gseurat/engine/audio/track_group.hpp"
#include "audio_command.hpp"
#include "track_group_state.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <memory>
#include <span>
#include <vector>

namespace gseurat::audio {

inline constexpr uint32_t kMaxCommandsPerBlock = 32;
inline constexpr uint32_t kMaxActiveGroupsHardCap = 16;
inline constexpr uint32_t kCommandQueueCapacity = 256;

struct EngineTelemetry {
    std::atomic<uint64_t> current_frame{0};
    std::atomic<uint32_t> dropped_commands{0};
    std::atomic<uint64_t> active_group_bitmap{0};
};

struct RtpcBus {
    static constexpr uint32_t kMaxRtpc = 64;
    std::array<std::atomic<float>, kMaxRtpc> values{};
};

struct TrackGroupRegistryEntry {
    TrackGroupMetadata                          metadata;
    std::vector<std::unique_ptr<IAudioSource>>  owned_stems;
};

class Mixer {
public:
    Mixer(uint32_t sample_rate, uint32_t channels,
          uint32_t buffer_frames, uint32_t max_active_groups);
    ~Mixer() = default;
    Mixer(const Mixer&) = delete;
    Mixer& operator=(const Mixer&) = delete;

    void render(std::span<float> out, uint32_t frames_this_block) noexcept;

    SpscRingBuffer<AudioCommand, kCommandQueueCapacity>& command_queue() noexcept { return commands_; }
    RtpcBus&         rtpc_bus()  noexcept { return rtpc_bus_; }
    EngineTelemetry& telemetry() noexcept { return telemetry_; }

    void register_track_group(uint32_t id, TrackGroupMetadata&& meta,
                              std::vector<std::unique_ptr<IAudioSource>>&& stems);

private:
    void apply_command(const AudioCommand& cmd) noexcept;
    void render_group(TrackGroupState& g, std::span<float> out,
                      uint32_t frames_this_block) noexcept;
    void mix_chunk(TrackGroupState& g, std::span<float> out,
                   uint32_t out_offset, uint32_t chunk_frames) noexcept;
    void maybe_trigger_pending_transition(TrackGroupState& g) noexcept;

    TrackGroupState* find_active_slot(uint32_t group_id) noexcept;
    TrackGroupState* acquire_slot(uint32_t group_id) noexcept;

    uint32_t sample_rate_;
    uint32_t channels_;
    uint32_t buffer_frames_;
    uint32_t max_active_groups_;

    SpscRingBuffer<AudioCommand, kCommandQueueCapacity> commands_;
    RtpcBus                                             rtpc_bus_;
    EngineTelemetry                                     telemetry_;

    std::vector<TrackGroupRegistryEntry> registry_;
    std::vector<TrackGroupState>  active_groups_;
    std::vector<float>            group_volume_scratch_;
    std::vector<float>            read_scratch_;
};

}  // namespace gseurat::audio
