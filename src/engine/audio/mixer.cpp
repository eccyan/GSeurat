#include "mixer.hpp"

#include <algorithm>
#include <cassert>
#include <cstring>
#include <glm/glm.hpp>
#include <glm/geometric.hpp>

namespace gseurat::audio {

Mixer::Mixer(uint32_t sample_rate, uint32_t channels,
             uint32_t buffer_frames, uint32_t max_active_groups,
             uint32_t max_oneshot_voices)
    : sample_rate_(sample_rate), channels_(channels),
      buffer_frames_(buffer_frames),
      max_active_groups_(std::min(max_active_groups, kMaxActiveGroupsHardCap)),
      max_oneshot_voices_(max_oneshot_voices),
      active_groups_(max_active_groups_),
      oneshot_voices_(max_oneshot_voices_),
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

    // Apply RTPC bindings
    const uint32_t nb = rtpc_binding_count_.load(std::memory_order_acquire);
    for (uint32_t bi = 0; bi < nb; ++bi) {
        const auto& b = rtpc_bindings_[bi];
        const float rv = rtpc_bus_.values[b.rtpc_id].load(std::memory_order_relaxed);
        // Map [0,1] → [min_out, max_out]
        const float out_val = b.min_out + (b.max_out - b.min_out) * std::clamp(rv, 0.0f, 1.0f);
        if (auto* g = find_active_slot(b.group_id); g && b.stem_index < g->stem_count) {
            g->stems[b.stem_index].volume.set_target(out_val, 32);  // 32-frame smooth
        }
    }

    for (auto& g : active_groups_) {
        if (g.status == TrackGroupState::Status::Idle) continue;
        render_group(g, out, frames_this_block);
    }

    // Snapshot listener position
    const glm::vec3 listener{
        listener_.x.load(std::memory_order_relaxed),
        listener_.y.load(std::memory_order_relaxed),
        listener_.z.load(std::memory_order_relaxed)};

    // Render oneshot voices
    for (auto& v : oneshot_voices_) {
        if (!v.source) continue;
        render_voice(v, out, frames_this_block, listener);
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
    case AudioCommand::Type::RequestTransition: {
        auto* g = find_active_slot(cmd.group_id);
        if (!g) return;
        g->status = TrackGroupState::Status::AwaitingTransition;
        g->pending_transition_target = cmd.secondary_group_id;
        g->pending_transition_xfade_frames = cmd.frame_count;
        break;
    }
    case AudioCommand::Type::PlayOneshot: {
        if (!sfx_registry_) return;
        const uint32_t sfx_id = cmd.stem_index;
        if (sfx_id >= sfx_registry_->size()) return;
        auto* v = acquire_voice();
        if (!v) {
            telemetry_.dropped_commands.fetch_add(1, std::memory_order_relaxed);
            return;
        }
        v->source       = (*sfx_registry_)[sfx_id].get();
        v->play_cursor  = 0;
        v->volume       = cmd.value;
        v->looping      = false;
        v->spatial      = false;
        v->generation   = next_generation_++;
        if (next_generation_ > 0xFFFF) next_generation_ = 1;
        break;
    }
    case AudioCommand::Type::PlayLoopingSpatial: {
        if (!sfx_registry_) return;
        const uint32_t sfx_id = cmd.stem_index;
        if (sfx_id >= sfx_registry_->size()) return;
        auto* v = acquire_voice();
        if (!v) {
            telemetry_.dropped_commands.fetch_add(1, std::memory_order_relaxed);
            return;
        }
        v->source       = (*sfx_registry_)[sfx_id].get();
        v->play_cursor  = 0;
        v->volume       = cmd.value;
        v->looping      = true;
        v->spatial      = true;
        v->pos_x        = cmd.pos[0];
        v->pos_y        = cmd.pos[1];
        v->pos_z        = cmd.pos[2];
        v->max_distance = cmd.max_distance;
        v->generation   = next_generation_++;
        if (next_generation_ > 0xFFFF) next_generation_ = 1;
        break;
    }
    case AudioCommand::Type::StopAllSfx: {
        for (auto& v : oneshot_voices_) v.source = nullptr;
        break;
    }
    }
}

// Helper: find next marker strictly after cursor
static const Marker* next_marker(const Marker* begin, const Marker* end, uint64_t cursor) noexcept {
    const Marker* m = begin;
    while (m < end && m->frame <= cursor) ++m;
    return (m < end) ? m : nullptr;
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

        uint64_t frames_until_marker = UINT64_MAX;
        if (g.status == TrackGroupState::Status::AwaitingTransition) {
            if (const Marker* m = next_marker(g.markers_begin, g.markers_end, g.play_cursor)) {
                frames_until_marker = m->frame - g.play_cursor;
            }
        }

        const uint64_t until_split = std::min(frames_until_boundary, frames_until_marker);
        const uint32_t chunk = static_cast<uint32_t>(
            std::min<uint64_t>(frames_remaining, until_split));
        if (chunk == 0) {
            g.status = TrackGroupState::Status::Idle;
            return;
        }

        mix_chunk(g, out, out_offset, chunk);

        out_offset       += chunk;
        frames_remaining -= chunk;
        g.play_cursor    += chunk;

        // Check if we hit a marker (before checking loop wrap)
        if (g.status == TrackGroupState::Status::AwaitingTransition
            && frames_until_marker != UINT64_MAX
            && chunk == static_cast<uint32_t>(frames_until_marker)) {
            maybe_trigger_pending_transition(g);
            // After triggering, g is now CrossfadingOut. The new target group
            // will be rendered on the NEXT call to render() (next block).
        }

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

void Mixer::maybe_trigger_pending_transition(TrackGroupState& g) noexcept {
    if (g.status != TrackGroupState::Status::AwaitingTransition) return;

    const uint64_t xfade = g.pending_transition_xfade_frames;
    g.status = TrackGroupState::Status::CrossfadingOut;
    g.group_volume.set_target(0.0f, xfade);

    const uint32_t target_id = g.pending_transition_target;
    const TrackGroupRegistryEntry* entry = nullptr;
    for (const auto& e : registry_) if (e.metadata.id == target_id) { entry = &e; break; }
    if (!entry) return;

    TrackGroupState* t = find_active_slot(target_id);
    if (!t) t = acquire_slot(target_id);
    if (!t) return;

    t->status       = TrackGroupState::Status::Playing;
    t->play_cursor  = 0;
    t->loop_start   = entry->metadata.loop_start;
    t->loop_end     = entry->metadata.loop_end;
    t->stem_count   = static_cast<uint8_t>(
        std::min<size_t>(entry->metadata.stems.size(), kMaxStemsPerGroup));
    t->markers_begin = entry->metadata.markers.data();
    t->markers_end   = entry->metadata.markers.data() + entry->metadata.markers.size();
    t->group_volume.force(0.0f);
    t->group_volume.set_target(1.0f, xfade);
    for (uint8_t i = 0; i < t->stem_count; ++i) {
        t->stems[i].source = entry->owned_stems[i].get();
        t->stems[i].volume.force(entry->metadata.stems[i].initial_volume);
    }
}

void Mixer::register_track_group(uint32_t id, TrackGroupMetadata&& meta,
                                  std::vector<std::unique_ptr<IAudioSource>>&& stems) {
    registry_.push_back({std::move(meta), std::move(stems)});
    (void)id;
}

OneshotVoice* Mixer::acquire_voice() noexcept {
    for (auto& v : oneshot_voices_) {
        if (!v.source) return &v;
    }
    return nullptr;
}

void Mixer::render_voice(OneshotVoice& v, std::span<float> out,
                          uint32_t frames, glm::vec3 listener) noexcept {
    const uint64_t source_len = v.source->total_frames();
    uint32_t to_render = frames;

    if (!v.looping && v.play_cursor + to_render > source_len) {
        to_render = static_cast<uint32_t>(source_len - v.play_cursor);
    }
    if (to_render == 0) {
        v.source = nullptr;  // auto-free
        return;
    }

    // Distance attenuation (spatial only, once per block)
    float spatial_gain = 1.0f;
    if (v.spatial) {
        const glm::vec3 pos{v.pos_x, v.pos_y, v.pos_z};
        const float dist = glm::length(listener - pos);
        spatial_gain = 1.0f - std::clamp(dist / v.max_distance, 0.0f, 1.0f);
        if (spatial_gain <= 0.0f) {
            v.play_cursor += to_render;
            if (v.looping && v.play_cursor >= source_len) v.play_cursor = 0;
            return;
        }
    }

    const float gain = v.volume * spatial_gain;
    const uint32_t src_ch = v.source->format().channels;
    const uint32_t out_ch = channels_;

    // Read into scratch and mix
    std::span<float> scratch(read_scratch_.data(),
                              static_cast<size_t>(to_render) * src_ch);
    v.source->read_frames(v.play_cursor, to_render, scratch);

    for (uint32_t f = 0; f < to_render; ++f) {
        if (src_ch == 1) {
            const float s = scratch[f] * gain;
            out[f * out_ch + 0] += s;
            out[f * out_ch + 1] += s;
        } else {
            out[f * out_ch + 0] += scratch[f * 2 + 0] * gain;
            out[f * out_ch + 1] += scratch[f * 2 + 1] * gain;
        }
    }

    v.play_cursor += to_render;

    if (v.looping && v.play_cursor >= source_len) {
        v.play_cursor = 0;
    }
    if (!v.looping && v.play_cursor >= source_len) {
        v.source = nullptr;
    }
}

}  // namespace gseurat::audio
