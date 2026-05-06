#pragma once
// ── Renderer "Store" Dumper ──
// Reports Gaussian splat rendering stats, culling, GPU timing, and streaming state.
// Satisfies DebugDumpable concept — no inheritance required.

#include "gseurat/engine/debug_dump.hpp"
#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/renderer.hpp"

#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat {

class RendererStatsDumper {
public:
    struct Snapshot {
        // Gaussian counts
        uint32_t total_gaussians    = 0;
        uint32_t visible_gaussians  = 0;
        uint32_t static_gaussians   = 0;
        uint32_t dynamic_gaussians  = 0;
        uint32_t max_capacity       = 0;
        uint32_t gaussian_budget    = 0;

        // Culling
        uint32_t culled_gaussians   = 0;   // total - visible
        float    cull_ratio         = 0.0f; // culled / total

        // Output resolution
        uint32_t output_width       = 0;
        uint32_t output_height      = 0;

        // GPU timing (last completed frame, raw — not averaged).
        // Single-frame spike attribution per #399.
        float depth_sort_ms         = 0.0f;
        float tile_sort_ms          = 0.0f;
        float rasterize_ms          = 0.0f;
        float gpu_total_ms          = 0.0f;

        // CPU frame time
        float fps                   = 0.0f;
        float frame_time_ms         = 0.0f;

        // PBD physics
        uint32_t pbd_count          = 0;
        uint32_t pbd_constraints    = 0;

        // Streaming (Phase 2/3)
        uint32_t streaming_active_chunks = 0;
        uint32_t streaming_active_splats = 0;
        bool     streaming_initialized   = false;
        uint32_t streaming_pending_loads = 0;

        // Per-chunk detail (proves which scene's content is currently
        // resident in VRAM — empty after a clean scene transition).
        struct ChunkRow {
            std::string status;
            uint32_t page_table_offset = 0;
            uint32_t splat_count       = 0;
            uint32_t slab_count        = 0;
        };
        std::vector<ChunkRow> chunks;

        // Render distance
        float max_render_distance   = 0.0f;

        std::vector<std::string> warnings;
    };

    using SnapshotFn = std::function<Snapshot()>;

    explicit RendererStatsDumper(SnapshotFn fn) : snapshot_fn_(std::move(fn)) {}

    [[nodiscard]] DebugDomain debug_domain() const noexcept { return DebugDomain::Store; }
    [[nodiscard]] std::string_view debug_name() const noexcept { return "RendererStats"; }

    [[nodiscard]] nlohmann::json dump_debug_state() const {
        const Snapshot snap = snapshot_fn_();

        nlohmann::json warnings = nlohmann::json::array();
        for (const auto& w : snap.warnings) {
            warnings.push_back(w);
        }

        return {
            {"store_name", "RendererStats"},
            {"state", {
                {"gaussians", {
                    {"total",    snap.total_gaussians},
                    {"visible",  snap.visible_gaussians},
                    {"culled",   snap.culled_gaussians},
                    {"cull_ratio", snap.cull_ratio},
                    {"static",   snap.static_gaussians},
                    {"dynamic",  snap.dynamic_gaussians},
                    {"max_capacity", snap.max_capacity},
                    {"budget",   snap.gaussian_budget},
                }},
                {"gpu_timing_ms", {
                    {"depth_sort",  snap.depth_sort_ms},
                    {"tile_sort",   snap.tile_sort_ms},
                    {"rasterize",   snap.rasterize_ms},
                    {"total",       snap.gpu_total_ms},
                }},
                {"frame", {
                    {"fps",           snap.fps},
                    {"frame_time_ms", snap.frame_time_ms},
                }},
                {"output_resolution", {snap.output_width, snap.output_height}},
                {"pbd", {
                    {"count",       snap.pbd_count},
                    {"constraints", snap.pbd_constraints},
                }},
                {"streaming", {
                    {"initialized",   snap.streaming_initialized},
                    {"active_chunks", snap.streaming_active_chunks},
                    {"active_splats", snap.streaming_active_splats},
                    {"pending_loads", snap.streaming_pending_loads},
                    {"chunks",        [&]() {
                        nlohmann::json arr = nlohmann::json::array();
                        for (const auto& c : snap.chunks) {
                            arr.push_back({
                                {"status",            c.status},
                                {"page_table_offset", c.page_table_offset},
                                {"splat_count",       c.splat_count},
                                {"slab_count",        c.slab_count},
                            });
                        }
                        return arr;
                    }()},
                }},
                {"max_render_distance", snap.max_render_distance},
            }},
            {"warnings", std::move(warnings)},
        };
    }

private:
    SnapshotFn snapshot_fn_;
};

// Concept check (compile-time verification)
static_assert(DebugDumpable<RendererStatsDumper>);

}  // namespace gseurat
