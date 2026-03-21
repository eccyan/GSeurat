#pragma once

#include "gseurat/engine/sprite_batch.hpp"

#include <glm/glm.hpp>

namespace gseurat {

struct ParallaxLayer {
    float z = 5.0f;
    float parallax_factor = 0.0f;
    float quad_width = 40.0f;
    float quad_height = 25.0f;
    float uv_repeat_x = 1.0f;
    float uv_repeat_y = 1.0f;
    glm::vec4 tint{1.0f};
    bool wall = false;
    float wall_y_offset = 15.0f;

    SpriteDrawInfo generate_draw_info(glm::vec2 camera_target_xy) const;
    SpriteDrawInfo generate_wall_draw_info(glm::vec2 camera_target_xy) const;
};

}  // namespace gseurat
