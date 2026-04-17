#include "mixer.hpp"

#include <algorithm>
#include <cassert>
#include <cstring>

namespace gseurat::audio {

Mixer::Mixer(uint32_t sample_rate, uint32_t channels,
             uint32_t buffer_frames, uint32_t max_active_groups)
    : sample_rate_(sample_rate), channels_(channels),
      buffer_frames_(buffer_frames),
      max_active_groups_(std::min(max_active_groups, kMaxActiveGroupsHardCap)),
      active_groups_(max_active_groups_),
      group_volume_scratch_(buffer_frames_),
      read_scratch_(static_cast<size_t>(buffer_frames_) * channels_) {
    registry_.reserve(64);
}

void Mixer::render(std::span<float> out, uint32_t frames_this_block) noexcept {
    std::fill(out.begin(), out.end(), 0.0f);

    AudioCommand cmd;
    for (uint32_t i = 0; i < kMaxCommandsPerBlock && commands_.try_pop(cmd); ++i) {
        apply_command(cmd);
    }

    for (auto& g : active_groups_) {
        if (g.status == TrackGroupState::Status::Idle) continue;
        render_group(g, out, frames_this_block);
    }

    telemetry_.current_frame.fetch_add(frames_this_block, std::memory_order_relaxed);
    uint64_t bitmap = 0;
    for (const auto& g : active_groups_) {
        if (g.status != TrackGroupState::Status::Idle && g.group_id < 64) {
            bitmap |= (1ULL << g.group_id);
        }
    }
    telemetry_.active_group_bitmap.store(bitmap, std::memory_order_relaxed);
}

TrackGroupState* Mixer::find_active_slot(uint32_t group_id) noexcept {
    for (auto& g : active_groups_)
        if (g.status != TrackGroupState::Status::Idle && g.group_id == group_id) return &g;
    return nullptr;
}

TrackGroupState* Mixer::acquire_slot(uint32_t group_id) noexcept {
    for (auto& g : active_groups_) {
        if (g.status == TrackGroupState::Status::Idle) {
            g = TrackGroupState{};
            g.group_id = group_id;
            return &g;
        }
    }
    return nullptr;
}

// Stubs — Task 3.3 provides real implementation.
void Mixer::apply_command(const AudioCommand&) noexcept {}
void Mixer::render_group(TrackGroupState&, std::span<float>, uint32_t) noexcept {}
void Mixer::mix_chunk(TrackGroupState&, std::span<float>, uint32_t, uint32_t) noexcept {}
void Mixer::maybe_trigger_pending_transition(TrackGroupState&) noexcept {}

void Mixer::register_track_group(uint32_t id, TrackGroupMetadata&& meta,
                                  std::vector<std::unique_ptr<IAudioSource>>&& stems) {
    registry_.push_back({std::move(meta), std::move(stems)});
    (void)id;
}

}  // namespace gseurat::audio
