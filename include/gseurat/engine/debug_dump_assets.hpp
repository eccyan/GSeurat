#pragma once
// ── AssetCache "Store" Dumper ──
// Reports loaded resource counts, streaming memory, and chunk states.
// Satisfies DebugDumpable concept — no inheritance required.

#include "gseurat/engine/debug_dump.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace gseurat {

class AssetCacheDumper {
public:
    struct Snapshot {
        // Texture cache
        uint32_t live_texture_count  = 0;
        uint64_t texture_memory_bytes = 0;

        // Font cache
        uint32_t live_font_count     = 0;

        // Async loading
        uint32_t pending_async_count = 0;

        // Chunk streaming (GsChunkStreamer)
        uint32_t total_manifest_chunks = 0;
        uint32_t loaded_chunks         = 0;
        uint32_t loading_chunks        = 0;
        uint64_t loaded_memory_bytes   = 0;
        uint64_t memory_budget_bytes   = 0;

        // GPU slab allocator (if streaming initialized)
        uint32_t slab_total            = 0;
        uint32_t slab_available        = 0;
        uint32_t splats_per_slab       = 0;
        uint64_t gpu_budget_bytes      = 0;

        // Staging uploader
        uint64_t staging_pending_bytes = 0;
        uint32_t staging_pending_count = 0;

        std::vector<std::string> warnings;
    };

    using SnapshotFn = std::function<Snapshot()>;

    explicit AssetCacheDumper(SnapshotFn fn) : snapshot_fn_(std::move(fn)) {}

    [[nodiscard]] DebugDomain debug_domain() const noexcept { return DebugDomain::Store; }
    [[nodiscard]] std::string_view debug_name() const noexcept { return "AssetCache"; }

    [[nodiscard]] nlohmann::json dump_debug_state() const {
        const Snapshot snap = snapshot_fn_();

        nlohmann::json warnings = nlohmann::json::array();
        for (const auto& w : snap.warnings) {
            warnings.push_back(w);
        }

        return {
            {"store_name", "AssetCache"},
            {"state", {
                {"textures", {
                    {"live_count",    snap.live_texture_count},
                    {"memory_bytes",  snap.texture_memory_bytes},
                }},
                {"fonts", {
                    {"live_count", snap.live_font_count},
                }},
                {"async", {
                    {"pending_count", snap.pending_async_count},
                }},
                {"chunk_streaming", {
                    {"manifest_chunks", snap.total_manifest_chunks},
                    {"loaded",          snap.loaded_chunks},
                    {"loading",         snap.loading_chunks},
                    {"memory_bytes",    snap.loaded_memory_bytes},
                    {"budget_bytes",    snap.memory_budget_bytes},
                }},
                {"gpu_slab_allocator", {
                    {"total_slabs",     snap.slab_total},
                    {"available_slabs", snap.slab_available},
                    {"splats_per_slab", snap.splats_per_slab},
                    {"gpu_budget_bytes", snap.gpu_budget_bytes},
                }},
                {"staging_uploader", {
                    {"pending_bytes", snap.staging_pending_bytes},
                    {"pending_count", snap.staging_pending_count},
                }},
            }},
            {"warnings", std::move(warnings)},
        };
    }

private:
    SnapshotFn snapshot_fn_;
};

// Concept check (compile-time verification)
static_assert(DebugDumpable<AssetCacheDumper>);

}  // namespace gseurat
