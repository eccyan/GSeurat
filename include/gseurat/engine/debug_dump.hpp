#pragma once
// ── Self-Reporting Debug Dump: C++23 Interface & Registry ──
// Symmetric with TypeScript @gseurat/debug-dump package.
//
// On-demand only: zero runtime cost. State gathering fires exclusively
// when triggered via CommandDispatcher ("debug_dump") or F12 shortcut.

#include <nlohmann/json.hpp>

#include <chrono>
#include <concepts>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat {

// ---------------------------------------------------------------------------
// Domain tag — partitions the dump into "eyes" (UI/layout) and "ears" (audio)
// ---------------------------------------------------------------------------

enum class DebugDomain : uint8_t { Eyes, Ears };

constexpr std::string_view to_string(DebugDomain d) noexcept {
    return d == DebugDomain::Eyes ? "eyes" : "ears";
}

// ---------------------------------------------------------------------------
// ADSR envelope state (forward-looking — null until SPC700 envelope lands)
// ---------------------------------------------------------------------------

struct AdsrState {
    enum class Phase : uint8_t { Attack, Decay, Sustain, Release };

    Phase phase           = Phase::Attack;
    float attack_ms       = 0.0f;
    float decay_ms        = 0.0f;
    float sustain_level   = 0.0f;
    float release_ms      = 0.0f;
    float current_level   = 0.0f;
    float elapsed_in_phase_ms = 0.0f;
};

inline nlohmann::json adsr_to_json(const AdsrState& a) {
    static constexpr const char* kPhaseNames[] = {
        "attack", "decay", "sustain", "release"
    };
    return {
        {"phase",              kPhaseNames[static_cast<uint8_t>(a.phase)]},
        {"attack_ms",          a.attack_ms},
        {"decay_ms",           a.decay_ms},
        {"sustain_level",      a.sustain_level},
        {"release_ms",         a.release_ms},
        {"current_level",      a.current_level},
        {"elapsed_in_phase_ms", a.elapsed_in_phase_ms},
    };
}

inline nlohmann::json adsr_to_json(const std::optional<AdsrState>& a) {
    return a ? adsr_to_json(*a) : nlohmann::json(nullptr);
}

// ---------------------------------------------------------------------------
// IDebugDumpable — C++23 concept
// ---------------------------------------------------------------------------
// Any class that satisfies this concept can be registered with the registry.
// No vtable overhead — the registry stores type-erased wrappers internally.

// clang-format off
template <typename T>
concept DebugDumpable = requires(const T& t) {
    { t.debug_domain() } noexcept -> std::same_as<DebugDomain>;
    { t.debug_name()   } noexcept -> std::convertible_to<std::string_view>;
    { t.dump_debug_state() }      -> std::same_as<nlohmann::json>;
};
// clang-format on

// ---------------------------------------------------------------------------
// DebugDumpRegistry — lives in AppBase, collects from all registered modules
// ---------------------------------------------------------------------------

class DebugDumpRegistry {
public:
    DebugDumpRegistry() = default;

    // Non-copyable, non-movable (lives as AppBase member)
    DebugDumpRegistry(const DebugDumpRegistry&) = delete;
    DebugDumpRegistry& operator=(const DebugDumpRegistry&) = delete;

    // ── Registration ──

    template <DebugDumpable T>
    void register_module(T* module) {
        entries_.push_back(Entry{
            .domain = module->debug_domain(),
            .name   = std::string(module->debug_name()),
            .dump   = [module]() { return module->dump_debug_state(); },
        });
    }

    void unregister_module(std::string_view name) {
        std::erase_if(entries_, [name](const Entry& e) { return e.name == name; });
    }

    // ── Collection (on-demand only) ──

    /** Gather state from all registered modules and assemble the envelope. */
    [[nodiscard]] nlohmann::json collect_all(std::string_view source) const {
        nlohmann::json eyes_components = nlohmann::json::array();
        nlohmann::json ears = nlohmann::json::object();
        bool has_ears = false;

        for (const auto& entry : entries_) {
            nlohmann::json state = entry.dump();

            if (entry.domain == DebugDomain::Eyes) {
                // Eyes modules return an array of component nodes
                if (state.is_array()) {
                    for (auto& node : state) {
                        eyes_components.push_back(std::move(node));
                    }
                }
            } else {
                // Ears modules return a full ears dump object
                if (!has_ears) {
                    ears = std::move(state);
                    has_ears = true;
                } else {
                    // Merge additional ears modules
                    if (state.contains("track_groups")) {
                        for (auto& tg : state["track_groups"]) {
                            ears["track_groups"].push_back(std::move(tg));
                        }
                    }
                    if (state.contains("voices")) {
                        for (auto& v : state["voices"]) {
                            ears["voices"].push_back(std::move(v));
                        }
                    }
                    if (state.contains("warnings")) {
                        for (auto& w : state["warnings"]) {
                            ears["warnings"].push_back(std::move(w));
                        }
                    }
                }
            }
        }

        auto now = std::chrono::system_clock::now();
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      now.time_since_epoch())
                      .count();

        // Build default ears if no audio module registered
        if (!has_ears) {
            ears = {
                {"global", {
                    {"master_volume", 0}, {"sample_rate", 0}, {"max_polyphony", 0},
                    {"active_voice_count", 0}, {"active_group_count", 0},
                    {"dropped_commands", 0},
                }},
                {"track_groups", nlohmann::json::array()},
                {"voices", nlohmann::json::array()},
                {"warnings", nlohmann::json::array()},
            };
        }

        return {
            {"version",      1},
            {"timestamp_ms", ms},
            {"source",       source},
            {"eyes",         {{"components", std::move(eyes_components)}}},
            {"ears",         std::move(ears)},
        };
    }

    /** Collect from a single domain only. */
    [[nodiscard]] nlohmann::json collect_domain(DebugDomain domain) const {
        nlohmann::json result;
        for (const auto& entry : entries_) {
            if (entry.domain != domain) continue;
            nlohmann::json state = entry.dump();
            if (domain == DebugDomain::Eyes) {
                if (!result.is_array()) result = nlohmann::json::array();
                if (state.is_array()) {
                    for (auto& node : state) result.push_back(std::move(node));
                }
            } else {
                if (result.is_null()) {
                    result = std::move(state);
                } else {
                    for (auto& tg : state["track_groups"])
                        result["track_groups"].push_back(std::move(tg));
                    for (auto& v : state["voices"])
                        result["voices"].push_back(std::move(v));
                    for (auto& w : state["warnings"])
                        result["warnings"].push_back(std::move(w));
                }
            }
        }
        return result;
    }

    [[nodiscard]] size_t module_count() const noexcept { return entries_.size(); }

private:
    struct Entry {
        DebugDomain domain;
        std::string name;
        std::function<nlohmann::json()> dump;
    };

    std::vector<Entry> entries_;
};

}  // namespace gseurat
