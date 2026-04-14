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

#ifdef GSEURAT_DEV_MODE
#include "gseurat/engine/collision_gen.hpp"
#include <imgui.h>

namespace gseurat {

void draw_collision_grid_overlay(ImDrawList* dl,
                                  const CollisionGrid& grid,
                                  glm::vec2 grid_origin,
                                  const glm::mat4& vp,
                                  float sw, float sh) {
    ImU32 solid_col    = IM_COL32(204, 0, 0, 77);    // red, alpha ~0.3
    ImU32 walkable_col = IM_COL32(0, 204, 0, 38);    // green, alpha ~0.15
    ImU32 grid_line_col = IM_COL32(255, 255, 255, 51); // white, alpha ~0.2

    for (uint32_t gz = 0; gz < grid.height; gz++) {
        for (uint32_t gx = 0; gx < grid.width; gx++) {
            float wx0 = grid_origin.x + gx * grid.cell_size;
            float wx1 = grid_origin.x + (gx + 1) * grid.cell_size;
            float wz0 = grid_origin.y + gz * grid.cell_size;
            float wz1 = grid_origin.y + (gz + 1) * grid.cell_size;
            float wy = grid.get_elevation(gx, gz);

            glm::vec3 p00(wx0, wy, wz0);
            glm::vec3 p10(wx1, wy, wz0);
            glm::vec3 p01(wx0, wy, wz1);
            glm::vec3 p11(wx1, wy, wz1);

            float sx00, sy00, sx10, sy10, sx01, sy01, sx11, sy11;
            bool v00 = project_to_screen(p00, vp, sw, sh, sx00, sy00);
            bool v10 = project_to_screen(p10, vp, sw, sh, sx10, sy10);
            bool v01 = project_to_screen(p01, vp, sw, sh, sx01, sy01);
            bool v11 = project_to_screen(p11, vp, sw, sh, sx11, sy11);

            if (!v00 && !v10 && !v01 && !v11) continue;

            float min_x = std::min({sx00, sx10, sx01, sx11});
            float max_x = std::max({sx00, sx10, sx01, sx11});
            float min_y = std::min({sy00, sy10, sy01, sy11});
            float max_y = std::max({sy00, sy10, sy01, sy11});
            if (max_x < 0 || min_x > sw || max_y < 0 || min_y > sh) continue;

            ImU32 fill = grid.is_solid(gx, gz) ? solid_col : walkable_col;

            dl->AddQuadFilled(
                ImVec2(sx00, sy00), ImVec2(sx10, sy10),
                ImVec2(sx11, sy11), ImVec2(sx01, sy01), fill);

            dl->AddLine(ImVec2(sx10, sy10), ImVec2(sx11, sy11), grid_line_col, 1.0f);
            dl->AddLine(ImVec2(sx01, sy01), ImVec2(sx11, sy11), grid_line_col, 1.0f);
        }
    }
}

}  // namespace gseurat
#endif
