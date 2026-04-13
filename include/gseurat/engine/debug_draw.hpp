#pragma once

#include "gseurat/engine/gs_animator.hpp"  // GsAnimRegion

#include <glm/glm.hpp>
#include <functional>

namespace gseurat {

using DrawLineFn = std::function<void(float x1, float y1, float x2, float y2,
                                       float thickness, glm::vec4 color)>;

// Project a 3D world position to 2D screen coordinates.
// Returns false if the point is behind the camera.
bool project_to_screen(const glm::vec3& world_pos, const glm::mat4& vp,
                        float screen_w, float screen_h,
                        float& out_x, float& out_y);

// Draw a wireframe sphere (projected circle on screen).
void draw_sphere_gizmo(const glm::vec3& center, float radius,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);

// Draw a wireframe axis-aligned box (8 corners, 12 edges).
void draw_box_gizmo(const glm::vec3& center, const glm::vec3& half_extents,
                      const glm::mat4& vp, float sw, float sh,
                      glm::vec4 color, const DrawLineFn& draw_line);

// Draw a region wireframe (sphere or box depending on shape).
void draw_region_gizmo(const GsAnimRegion& region, const glm::vec3& offset,
                         const glm::mat4& vp, float sw, float sh,
                         glm::vec4 color, const DrawLineFn& draw_line);

}  // namespace gseurat
