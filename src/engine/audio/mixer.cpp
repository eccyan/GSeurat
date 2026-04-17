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

void Mixer::apply_command(const AudioCommand& cmd) noexcept {
    switch (cmd.type) {
    case AudioCommand::Type::PlayGroup: {
        // Look up the group_id in registry_ (linear scan — small N)
        TrackGroupRegistryEntry* entry = nullptr;
        for (auto& e : registry_) {
            if (e.metadata.id == cmd.group_id) { entry = &e; break; }
        }
        if (!entry) return;

        auto* slot = acquire_slot(cmd.group_id);
        if (!slot) return;

        const auto& meta = entry->metadata;
        slot->status      = TrackGroupState::Status::Playing;
        slot->play_cursor = 0;
        slot->loop_start  = meta.loop_start;
        slot->loop_end    = meta.loop_end;

        const auto stem_n = static_cast<uint8_t>(
            std::min<size_t>(meta.stems.size(), kMaxStemsPerGroup));
        slot->stem_count = stem_n;
        for (uint8_t i = 0; i < stem_n; ++i) {
            slot->stems[i].source = entry->owned_stems[i].get();
            slot->stems[i].volume.force(meta.stems[i].initial_volume);
        }
        slot->group_volume.force(1.0f);

        // Copy marker pointers
        if (!meta.markers.empty()) {
            slot->markers_begin = meta.markers.data();
            slot->markers_end   = meta.markers.data() + meta.markers.size();
        } else {
            slot->markers_begin = nullptr;
            slot->markers_end   = nullptr;
        }
        break;
    }
    case AudioCommand::Type::StopGroup: {
        auto* slot = find_active_slot(cmd.group_id);
        if (slot) slot->status = TrackGroupState::Status::Idle;
        break;
    }
    case AudioCommand::Type::SetStemVolume: {
        auto* slot = find_active_slot(cmd.group_id);
        if (slot && cmd.stem_index < slot->stem_count)
            slot->stems[cmd.stem_index].volume.set_target(cmd.value, cmd.frame_count);
        break;
    }
    case AudioCommand::Type::SetGroupVolume: {
        auto* slot = find_active_slot(cmd.group_id);
        if (slot) slot->group_volume.set_target(cmd.value, cmd.frame_count);
        break;
    }
    case AudioCommand::Type::RequestTransition:
        // Stub — Task 3.6 fills this in.
        break;
    }
}

void Mixer::render_group(TrackGroupState& g, std::span<float> out,
                          uint32_t frames_remaining) noexcept {
    if (g.stem_count == 0 || g.stems[0].source == nullptr) {
        g.status = TrackGroupState::Status::Idle;
        return;
    }

    uint32_t out_offset = 0;
    while (frames_remaining > 0) {
        const uint64_t source_len = g.stems[0].source->total_frames();
        const uint64_t frames_until_boundary = (g.loop_end > 0)
            ? (g.loop_end - g.play_cursor)
            : (source_len - g.play_cursor);

        const uint32_t chunk = static_cast<uint32_t>(
            std::min<uint64_t>(frames_remaining, frames_until_boundary));
        if (chunk == 0) {
            g.status = TrackGroupState::Status::Idle;
            return;
        }

        mix_chunk(g, out, out_offset, chunk);

        out_offset       += chunk;
        frames_remaining -= chunk;
        g.play_cursor    += chunk;

        if (g.loop_end > 0 && g.play_cursor == g.loop_end) {
            g.play_cursor = g.loop_start;
            maybe_trigger_pending_transition(g);
        } else if (g.loop_end == 0 && g.play_cursor >= source_len) {
            g.status = TrackGroupState::Status::Idle;
            return;
        }
    }

    // Handle crossfade-out termination
    if (g.status == TrackGroupState::Status::CrossfadingOut
        && g.group_volume.settled() && g.group_volume.current() == 0.0f) {
        g.status = TrackGroupState::Status::Idle;
    }
}

void Mixer::mix_chunk(TrackGroupState& g, std::span<float> out,
                       uint32_t out_offset, uint32_t chunk_frames) noexcept {
    // Pre-compute per-frame group volume (tick once per frame, not once per stem)
    for (uint32_t f = 0; f < chunk_frames; ++f) {
        group_volume_scratch_[f] = g.group_volume.tick();
    }

    const uint32_t out_ch = channels_;

    for (uint8_t si = 0; si < g.stem_count; ++si) {
        auto& stem = g.stems[si];
        if (!stem.source) continue;

        const uint32_t src_ch = stem.source->format().channels;
        std::span<float> scratch(read_scratch_.data(),
                                  static_cast<size_t>(chunk_frames) * src_ch);
        stem.source->read_frames(g.play_cursor, chunk_frames, scratch);

        for (uint32_t f = 0; f < chunk_frames; ++f) {
            const float gain = stem.volume.tick() * group_volume_scratch_[f];
            if (src_ch == 1) {
                // Mono -> stereo broadcast
                const float s = scratch[f] * gain;
                out[(out_offset + f) * out_ch + 0] += s;
                out[(out_offset + f) * out_ch + 1] += s;
            } else {
                out[(out_offset + f) * out_ch + 0] += scratch[f * 2 + 0] * gain;
                out[(out_offset + f) * out_ch + 1] += scratch[f * 2 + 1] * gain;
            }
        }
    }
}

// Stub — Task 3.6 fills this in.
void Mixer::maybe_trigger_pending_transition(TrackGroupState&) noexcept {}

void Mixer::register_track_group(uint32_t id, TrackGroupMetadata&& meta,
                                  std::vector<std::unique_ptr<IAudioSource>>&& stems) {
    registry_.push_back({std::move(meta), std::move(stems)});
    (void)id;
}

}  // namespace gseurat::audio
