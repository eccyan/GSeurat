#pragma once

#include "gseurat/engine/sprite_batch.hpp"

#include <vector>

namespace gseurat {

struct DrawLists {
    std::vector<SpriteDrawInfo> entity;
    std::vector<SpriteDrawInfo> outline;
    std::vector<SpriteDrawInfo> shadow;
    std::vector<SpriteDrawInfo> reflection;
    std::vector<SpriteDrawInfo> overlay;
    std::vector<SpriteDrawInfo> ui;
    std::vector<SpriteDrawInfo> minimap;

    void clear_per_frame() {
        overlay.clear();
        ui.clear();
    }
};

}  // namespace gseurat
