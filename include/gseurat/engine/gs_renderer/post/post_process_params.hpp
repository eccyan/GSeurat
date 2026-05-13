#pragma once

#include <glm/glm.hpp>

#include <cstdint>

namespace gseurat {

// Post-process parameters forwarded from the composite pipeline to GS compute.
// Mirrors relevant fields from PostProcessParams for consistent visual treatment.
// Phase 5b: extracted into its own header so GsPostProcessSystem can include
// it without dragging gs_renderer.hpp (which would create a cycle). The
// struct is still re-exported by gs_renderer.hpp for external API stability.
struct GsPostProcessParams {
    float fog_density = 0.0f;
    float fog_color_r = 0.3f;
    float fog_color_g = 0.35f;
    float fog_color_b = 0.45f;
    float exposure = 1.2f;
    float vignette_radius = 0.75f;
    float vignette_softness = 0.45f;
    float bloom_intensity = 0.35f;
    float bloom_threshold = 1.0f;
    float fade_amount = 0.0f;
    float flash_r = 0.0f;
    float flash_g = 0.0f;
    float flash_b = 0.0f;
    float ca_intensity = 0.0f;
    float dof_focus_distance = 12.0f;
    float dof_focus_range = 3.0f;
    float dof_max_blur = 0.5f;
    float far_plane = 1000.0f;  // GS camera far plane for depth normalization

    // Hybrid background (ground plane + sky gradient)
    glm::vec3 ground_color{0.0f};  // RGB ground color (0 = disabled)
    glm::vec3 sky_color{0.0f};     // RGB sky color (0 = disabled)
    float horizon_y = 0.5f;        // Normalized screen Y of horizon (0=top, 1=bottom)
    bool background_enabled = false;

    // Scene-transition overlay (final mix() applied at end of compositing).
    // overlay_alpha == 0 produces a shader no-op.
    float overlay_r = 1.0f;
    float overlay_g = 1.0f;
    float overlay_b = 1.0f;
    float overlay_alpha = 0.0f;
    uint32_t overlay_effect_type = 0;  // 0 = solid fade, 1 = left-to-right wipe
};

// GPU UBO layout for gs_post_process.comp (std140, 8 × vec4 + 16 = 144 bytes)
struct GsPostProcessUbo {
    glm::vec4 fog_params;         // density, r, g, b
    glm::vec4 exposure_vignette;  // exposure, radius, softness, bloom_intensity
    glm::vec4 bloom_fade;         // bloom_threshold, fade_amount, flash_r, flash_g
    glm::vec4 effects;            // flash_b, ca_intensity, dof_focus_dist, dof_focus_range
    glm::vec4 dimensions;         // dof_max_blur, width, height, far_plane
    glm::vec4 ground_sky;         // ground_r, ground_g, ground_b, horizon_y
    glm::vec4 sky_enable;         // sky_r, sky_g, sky_b, enable (> 0.5 = on)
    glm::vec4 overlay;            // r, g, b, alpha (scene transition overlay)
    uint32_t  overlay_effect_type; // 0 = solid fade, 1 = left-to-right wipe
    uint32_t  _pad0;
    uint32_t  _pad1;
    uint32_t  _pad2;
};

}  // namespace gseurat
