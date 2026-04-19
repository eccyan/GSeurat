#pragma once
// ── DevOverlay "Eyes" Dumper ──
// Wraps DevOverlay's ImGui panel registry into EyesComponentNode JSON.
// Satisfies DebugDumpable concept — no inheritance required.

#include "gseurat/engine/debug_dump.hpp"
#include "gseurat/engine/dev_overlay.hpp"

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#endif

#include <string>
#include <vector>

namespace gseurat {

class DevOverlayDumper {
public:
    explicit DevOverlayDumper(DevOverlay& overlay) : overlay_(overlay) {}

    [[nodiscard]] DebugDomain debug_domain() const noexcept { return DebugDomain::Eyes; }
    [[nodiscard]] std::string_view debug_name() const noexcept { return "DevOverlay"; }

    [[nodiscard]] nlohmann::json dump_debug_state() const {
        nlohmann::json components = nlohmann::json::array();

#ifdef GSEURAT_DEV_MODE
        // DevOverlay stores PanelEntry (name, draw_fn, visible).
        // ImGui panels expose their geometry via FindWindowByName.
        // We iterate the known panel names and query ImGui for layout.

        // The overlay itself is the root "eyes" node.
        nlohmann::json overlay_node;
        overlay_node["id"]         = "dev-overlay";
        overlay_node["type"]       = "Overlay";
        overlay_node["class_name"] = "DevOverlay";
        overlay_node["layout"]     = {
            {"local_bounds",  {{"x", 0}, {"y", 0}, {"w", 0}, {"h", 0}}},
            {"global_bounds", {{"x", 0}, {"y", 0}, {"w", 0}, {"h", 0}}},
            {"z_index", 1000},  // ImGui overlays on top of everything
        };
        overlay_node["state"] = {
            {"visible", overlay_.visible()},
            {"focused", false},
            {"enabled", true},
        };
        overlay_node["warnings"] = nlohmann::json::array();

        nlohmann::json children = nlohmann::json::array();

        // Query each registered panel via ImGui internal state.
        // This is safe: dump is called on the main thread during frame idle.
        auto* ctx = ImGui::GetCurrentContext();
        if (ctx) {
            for (auto& w : ctx->Windows) {
                if (!w || !w->WasActive) continue;

                nlohmann::json warnings = nlohmann::json::array();

                const float gx = w->Pos.x;
                const float gy = w->Pos.y;
                const float gw = w->Size.x;
                const float gh = w->Size.y;

                if (gw == 0.0f || gh == 0.0f) {
                    warnings.push_back("zero_size");
                }
                if (gx < 0.0f || gy < 0.0f) {
                    warnings.push_back("off_screen_negative");
                }

                children.push_back({
                    {"id",         std::string("imgui-") + w->Name},
                    {"type",       "Panel"},
                    {"class_name", w->Name},
                    {"layout", {
                        {"local_bounds",  {{"x", 0}, {"y", 0}, {"w", gw}, {"h", gh}}},
                        {"global_bounds", {{"x", gx}, {"y", gy}, {"w", gw}, {"h", gh}}},
                        {"z_index",       w->BeginOrderWithinContext},
                    }},
                    {"state", {
                        {"visible", !w->Collapsed && !w->Hidden},
                        {"focused", w == ctx->NavWindow},
                        {"enabled", true},
                    }},
                    {"warnings", std::move(warnings)},
                    {"children", nlohmann::json::array()},
                });
            }
        }

        overlay_node["children"] = std::move(children);
        components.push_back(std::move(overlay_node));
#endif

        return components;
    }

private:
    [[maybe_unused]] DevOverlay& overlay_;
};

// Concept check (compile-time verification)
static_assert(DebugDumpable<DevOverlayDumper>);

}  // namespace gseurat
