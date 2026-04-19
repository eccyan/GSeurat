#pragma once
// ── AudioEngine "Ears" Dumper ──
// Wraps AudioEngine + Mixer internal state into EarsDump JSON.
// Satisfies DebugDumpable concept — no inheritance required.
//
// IMPORTANT: This reads Mixer state on the game thread. The dump is a
// snapshot — voice state may advance by a few frames between reads.
// This is acceptable for debugging; it is not a synchronization point.

#include "gseurat/engine/debug_dump.hpp"
#include "gseurat/engine/audio/audio_engine.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat {

// Forward-declare mixer internals we need to read.
// The actual AudioEngineDumper accesses these through the AudioEngine's
// public API + a friend accessor for Mixer state.
namespace audio {
class Mixer;
struct TrackGroupRegistryEntry;
struct TrackGroupState;
struct OneshotVoice;
}  // namespace audio

class AudioEngineDumper {
public:
    // Minimal state snapshot — populated by the caller from Mixer internals.
    // This avoids exposing Mixer's private API in the header.

    struct StemSnapshot {
        uint32_t    index       = 0;
        std::string asset_ref;          // from StemMetadata::source_path
        float       volume      = 0.0f;
        std::optional<AdsrState> adsr;  // null until SPC700 envelope lands
    };

    struct TrackGroupSnapshot {
        uint32_t    group_id    = 0;
        std::string status;             // "Idle", "Playing", etc.
        uint64_t    play_cursor = 0;
        uint64_t    loop_start  = 0;
        uint64_t    loop_end    = 0;
        float       group_volume = 0.0f;
        std::vector<StemSnapshot> stems;
    };

    struct VoiceSnapshot {
        uint32_t    pool_index  = 0;
        uint32_t    generation  = 0;
        std::string asset_ref;
        float       volume      = 0.0f;
        bool        spatial     = false;
        bool        looping     = false;
        float       pos_x       = 0.0f;
        float       pos_y       = 0.0f;
        float       pos_z       = 0.0f;
        float       max_distance = 0.0f;
        uint64_t    play_cursor = 0;
        std::optional<AdsrState> adsr;  // null until SPC700 envelope
    };

    struct Snapshot {
        float    master_volume       = 0.0f;
        uint32_t sample_rate         = 0;
        uint32_t max_polyphony       = 0;
        uint32_t active_voice_count  = 0;
        uint32_t active_group_count  = 0;
        uint32_t dropped_commands    = 0;
        std::vector<TrackGroupSnapshot> track_groups;
        std::vector<VoiceSnapshot>      voices;
        std::vector<std::string>        warnings;
    };

    // The snapshot getter is injected by the caller — keeps Mixer internals private.
    using SnapshotFn = std::function<Snapshot()>;

    explicit AudioEngineDumper(SnapshotFn fn) : snapshot_fn_(std::move(fn)) {}

    [[nodiscard]] DebugDomain debug_domain() const noexcept { return DebugDomain::Ears; }
    [[nodiscard]] std::string_view debug_name() const noexcept { return "AudioEngine"; }

    [[nodiscard]] nlohmann::json dump_debug_state() const {
        const Snapshot snap = snapshot_fn_();

        // ── Global ──
        nlohmann::json global = {
            {"master_volume",       snap.master_volume},
            {"sample_rate",         snap.sample_rate},
            {"max_polyphony",       snap.max_polyphony},
            {"active_voice_count",  snap.active_voice_count},
            {"active_group_count",  snap.active_group_count},
            {"dropped_commands",    snap.dropped_commands},
        };

        // ── Track groups ──
        nlohmann::json track_groups = nlohmann::json::array();
        for (const auto& tg : snap.track_groups) {
            nlohmann::json stems = nlohmann::json::array();
            for (const auto& s : tg.stems) {
                stems.push_back({
                    {"index",     s.index},
                    {"asset_ref", s.asset_ref},
                    {"volume",    s.volume},
                    {"adsr",      adsr_to_json(s.adsr)},
                });
            }
            track_groups.push_back({
                {"group_id",           tg.group_id},
                {"status",             tg.status},
                {"play_cursor_frames", tg.play_cursor},
                {"loop_start",         tg.loop_start},
                {"loop_end",           tg.loop_end},
                {"group_volume",       tg.group_volume},
                {"stems",              std::move(stems)},
            });
        }

        // ── Voices ──
        nlohmann::json voices = nlohmann::json::array();
        for (const auto& v : snap.voices) {
            voices.push_back({
                {"pool_index",         v.pool_index},
                {"generation",         v.generation},
                {"asset_ref",          v.asset_ref},
                {"volume",             v.volume},
                {"spatial",            v.spatial},
                {"looping",            v.looping},
                {"position",           {v.pos_x, v.pos_y, v.pos_z}},
                {"max_distance",       v.max_distance},
                {"play_cursor_frames", v.play_cursor},
                {"adsr",               adsr_to_json(v.adsr)},
            });
        }

        // ── Warnings ──
        nlohmann::json warnings = nlohmann::json::array();
        for (const auto& w : snap.warnings) {
            warnings.push_back(w);
        }

        return {
            {"global",       std::move(global)},
            {"track_groups", std::move(track_groups)},
            {"voices",       std::move(voices)},
            {"warnings",     std::move(warnings)},
        };
    }

private:
    SnapshotFn snapshot_fn_;
};

// Concept check (compile-time verification)
static_assert(DebugDumpable<AudioEngineDumper>);

}  // namespace gseurat
