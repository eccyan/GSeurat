#pragma once
// ── CollisionSystem "Store" Dumper ──
// Reports primitive-based collision stats, BVH health, and NavZone counts.
// Satisfies DebugDumpable concept — no inheritance required.

#include "gseurat/engine/debug_dump.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat {

class CollisionSystemDumper {
public:
    struct Snapshot {
        // Primitive counts by type
        uint32_t box_count      = 0;
        uint32_t sphere_count   = 0;
        uint32_t capsule_count  = 0;
        uint32_t total_static   = 0;
        uint32_t total_dynamic  = 0;

        // BVH health
        uint32_t bvh_node_count = 0;
        uint32_t bvh_leaf_count = 0;
        uint32_t bvh_depth      = 0;
        bool     bvh_empty      = true;
        bool     cache_dirty    = false;

        // Trigger vs solid breakdown
        uint32_t trigger_count  = 0;
        uint32_t solid_count    = 0;

        // NavZones (from legacy CollisionGrid)
        uint32_t nav_zone_count = 0;  // distinct non-zero zone IDs
        uint32_t grid_width     = 0;
        uint32_t grid_height    = 0;

        std::vector<std::string> warnings;
    };

    using SnapshotFn = std::function<Snapshot()>;

    explicit CollisionSystemDumper(SnapshotFn fn) : snapshot_fn_(std::move(fn)) {}

    [[nodiscard]] DebugDomain debug_domain() const noexcept { return DebugDomain::Store; }
    [[nodiscard]] std::string_view debug_name() const noexcept { return "CollisionSystem"; }

    [[nodiscard]] nlohmann::json dump_debug_state() const {
        const Snapshot snap = snapshot_fn_();

        nlohmann::json warnings = nlohmann::json::array();
        for (const auto& w : snap.warnings) {
            warnings.push_back(w);
        }

        return {
            {"store_name", "CollisionSystem"},
            {"state", {
                {"primitives", {
                    {"box",     snap.box_count},
                    {"sphere",  snap.sphere_count},
                    {"capsule", snap.capsule_count},
                    {"total_static",  snap.total_static},
                    {"total_dynamic", snap.total_dynamic},
                }},
                {"bvh", {
                    {"node_count", snap.bvh_node_count},
                    {"leaf_count", snap.bvh_leaf_count},
                    {"depth",      snap.bvh_depth},
                    {"empty",      snap.bvh_empty},
                }},
                {"triggers_vs_solid", {
                    {"trigger", snap.trigger_count},
                    {"solid",   snap.solid_count},
                }},
                {"nav_zones", {
                    {"distinct_zone_count", snap.nav_zone_count},
                    {"grid_width",  snap.grid_width},
                    {"grid_height", snap.grid_height},
                }},
                {"cache_dirty", snap.cache_dirty},
            }},
            {"warnings", std::move(warnings)},
        };
    }

private:
    SnapshotFn snapshot_fn_;
};

// Concept check (compile-time verification)
static_assert(DebugDumpable<CollisionSystemDumper>);

}  // namespace gseurat
