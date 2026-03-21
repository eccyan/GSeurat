#pragma once

#include "gseurat/engine/sprite_batch.hpp"
#include "gseurat/engine/tilemap.hpp"

#include <glm/glm.hpp>
#include <utility>
#include <vector>

namespace gseurat {

class Minimap {
public:
    struct Config {
        float screen_x = 1280.0f - 170.0f;  // top-right corner
        float screen_y = 10.0f;
        float size = 160.0f;                  // square minimap
        float border = 2.0f;
        glm::vec4 border_color{0.3f, 0.3f, 0.4f, 0.9f};
        glm::vec4 bg_color{0.02f, 0.02f, 0.05f, 0.75f};
    };

    void set_config(const Config& cfg) { config_ = cfg; }
    const Config& config() const { return config_; }

    void build_sprites(const TileLayer& layer,
                       glm::vec2 player_pos,
                       const std::vector<std::pair<glm::vec2, glm::vec4>>& npc_markers,
                       std::vector<SpriteDrawInfo>& out);

private:
    Config config_;
    static glm::vec4 tile_color(uint16_t tile_id);
};

}  // namespace gseurat
