#include "gseurat/engine/animation.hpp"

#include <algorithm>
#include <stdexcept>

namespace gseurat {

void AnimationController::set_sheet(Tileset tileset) {
    sheet_ = tileset;
}

void AnimationController::add_clip(AnimationClip clip) {
    clips_.push_back(std::move(clip));
}

void AnimationController::play(const std::string& clip_name) {
    for (int i = 0; i < static_cast<int>(clips_.size()); ++i) {
        if (clips_[i].name == clip_name) {
            current_clip_ = i;
            current_frame_ = 0;
            frame_timer_ = 0.0f;
            recompute_uvs();
            return;
        }
    }
    // clip not found — no-op
}

void AnimationController::update(float dt) {
    if (current_clip_ < 0 || current_clip_ >= static_cast<int>(clips_.size())) return;

    const AnimationClip& clip = clips_[current_clip_];
    if (clip.frames.empty()) return;

    frame_timer_ += dt;

    while (true) {
        const AnimationFrame& frame = clip.frames[current_frame_];
        if (frame_timer_ < frame.duration) break;

        frame_timer_ -= frame.duration;

        uint32_t next = current_frame_ + 1;
        if (next >= static_cast<uint32_t>(clip.frames.size())) {
            if (clip.looping) {
                next = 0;
            } else {
                // clamp at last frame
                next = static_cast<uint32_t>(clip.frames.size()) - 1;
                frame_timer_ = 0.0f;
                break;
            }
        }
        current_frame_ = next;
    }

    recompute_uvs();
}

void AnimationController::recompute_uvs() {
    if (current_clip_ < 0 || current_clip_ >= static_cast<int>(clips_.size())) return;
    const AnimationClip& clip = clips_[current_clip_];
    if (clip.frames.empty()) return;

    uint32_t tile_id = clip.frames[current_frame_].tile_id;
    uv_min_ = sheet_.uv_min(tile_id);
    uv_max_ = sheet_.uv_max(tile_id);
}

}  // namespace gseurat
