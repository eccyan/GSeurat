#pragma once

#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"

#include <string>
#include <vector>

#include <glm/glm.hpp>

namespace vulkan_game {

class TextRenderer {
public:
    void init(const FontAtlas& atlas);

    std::vector<SpriteDrawInfo> render_text(const std::string& text,
                                            float x, float y, float z,
                                            float scale, glm::vec4 color) const;

    glm::vec2 measure_text(const std::string& text, float scale) const;

    std::vector<SpriteDrawInfo> render_wrapped(const std::string& text,
                                               float x, float y, float z,
                                               float scale, glm::vec4 color,
                                               float max_width) const;

private:
    const FontAtlas* atlas_ = nullptr;
};

}  // namespace vulkan_game
