#pragma once

#include "gseurat/engine/tilemap.hpp"

#include <string>
#include <vector>

#include <glm/glm.hpp>

namespace gseurat {

struct AnimationFrame {
    uint32_t tile_id;
    float duration;  // seconds
};

struct AnimationClip {
    std::string name;
    std::vector<AnimationFrame> frames;
    bool looping = true;
};

class AnimationController {
public:
    void set_sheet(Tileset tileset);
    void add_clip(AnimationClip clip);
    void play(const std::string& clip_name);  // restarts from frame 0
    void update(float dt);                     // handles frame skipping on large dt

    glm::vec2 current_uv_min() const { return uv_min_; }
    glm::vec2 current_uv_max() const { return uv_max_; }

private:
    void recompute_uvs();

    Tileset sheet_{};
    std::vector<AnimationClip> clips_;
    int current_clip_ = -1;   // -1 = no clip
    uint32_t current_frame_ = 0;
    float frame_timer_ = 0.0f;
    glm::vec2 uv_min_{0.0f, 0.0f};
    glm::vec2 uv_max_{1.0f, 1.0f};
};

}  // namespace gseurat
