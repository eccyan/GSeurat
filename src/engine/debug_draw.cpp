#include "gseurat/engine/debug_draw.hpp"

#include <algorithm>
#include <cmath>

namespace gseurat {

bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                        float screen_w, float screen_h,
                        float& out_x, float& out_y) {
    glm::vec4 clip = vp * glm::vec4(world_pos, 1.0f);
    if (clip.w <= 0.001f) return false;
    glm::vec3 ndc = glm::vec3(clip) / clip.w;
    if (ndc.z < 0.0f || ndc.z > 1.0f) return false;
    out_x = (ndc.x * 0.5f + 0.5f) * screen_w;
    out_y = (1.0f - (ndc.y * 0.5f + 0.5f)) * screen_h;  // Y-down for screen
    return true;
}

void draw_sphere_gizmo(const glm::vec3& center, float radius,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line) {
    float cx, cy;
    if (!project_to_screen(center, vp, sw, sh, cx, cy)) return;

    // Project an edge point to estimate screen-space radius
    glm::vec3 edge = center + glm::vec3(radius, 0.0f, 0.0f);
    float ex, ey;
    float sr = 15.0f;  // fallback screen radius
    if (project_to_screen(edge, vp, sw, sh, ex, ey)) {
        sr = std::abs(ex - cx);
        sr = std::clamp(sr, 3.0f, 300.0f);
    }

    // Draw circle as line segments
    constexpr int segments = 24;
    constexpr float step = 2.0f * 3.14159265f / static_cast<float>(segments);
    for (int i = 0; i < segments; i++) {
        float a1 = static_cast<float>(i) * step;
        float a2 = static_cast<float>(i + 1) * step;
        float x1 = cx + std::cos(a1) * sr;
        float y1 = cy + std::sin(a1) * sr;
        float x2 = cx + std::cos(a2) * sr;
        float y2 = cy + std::sin(a2) * sr;
        draw_line(x1, y1, x2, y2, 1.5f, color);
    }
}

void draw_box_gizmo(const glm::vec3& center, const glm::vec3& half,
                      const glm::mat4& vp, float sw, float sh,
                      glm::vec4 color, const DrawLineFn& draw_line) {
    glm::vec3 corners[8] = {
        center + glm::vec3(-half.x, -half.y, -half.z),
        center + glm::vec3( half.x, -half.y, -half.z),
        center + glm::vec3( half.x,  half.y, -half.z),
        center + glm::vec3(-half.x,  half.y, -half.z),
        center + glm::vec3(-half.x, -half.y,  half.z),
        center + glm::vec3( half.x, -half.y,  half.z),
        center + glm::vec3( half.x,  half.y,  half.z),
        center + glm::vec3(-half.x,  half.y,  half.z),
    };
    float pts_x[8], pts_y[8];
    bool vis[8];
    for (int i = 0; i < 8; i++) {
        vis[i] = project_to_screen(corners[i], vp, sw, sh, pts_x[i], pts_y[i]);
    }
    constexpr int edges[12][2] = {
        {0,1},{1,2},{2,3},{3,0}, {4,5},{5,6},{6,7},{7,4}, {0,4},{1,5},{2,6},{3,7}
    };
    for (const auto& e : edges) {
        if (vis[e[0]] && vis[e[1]]) {
            draw_line(pts_x[e[0]], pts_y[e[0]], pts_x[e[1]], pts_y[e[1]], 1.0f, color);
        }
    }
}

void draw_region_gizmo(const GsAnimRegion& region, const glm::vec3& offset,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line) {
    glm::vec3 center = region.center + offset;
    if (region.shape == GsAnimRegion::Shape::Box) {
        draw_box_gizmo(center, region.half_extents, vp, sw, sh, color, draw_line);
    } else {
        draw_sphere_gizmo(center, region.radius, vp, sw, sh, color, draw_line);
    }
}

}  // namespace gseurat
