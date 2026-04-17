#include "audio_zone_system.hpp"

namespace gseurat {

static bool inside_aabb(const glm::vec3& p, const glm::vec3& lo, const glm::vec3& hi) {
    return p.x >= lo.x && p.x <= hi.x
        && p.y >= lo.y && p.y <= hi.y
        && p.z >= lo.z && p.z <= hi.z;
}

void AudioZoneSystem::tick(glm::vec3 player_pos, std::span<AudioZoneComponent> zones) {
    if (!engine_) return;
    for (auto& z : zones) {
        const bool now_in = inside_aabb(player_pos, z.bounds_min, z.bounds_max);
        if (now_in && !z.player_inside) {
            // Enter
            switch (z.action_on_enter) {
            case AudioZoneComponent::Action::Play:
                engine_->play_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::PlayOrTransition:
                engine_->play_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::Stop:
                engine_->stop_group(z.track_group_id);
                break;
            }
        } else if (!now_in && z.player_inside) {
            // Exit
            switch (z.action_on_exit) {
            case AudioZoneComponent::Action::Stop:
                if (z.exit_fade_ms > 0) {
                    engine_->set_group_volume(z.track_group_id, 0.0f, z.exit_fade_ms);
                }
                engine_->stop_group(z.track_group_id);
                break;
            case AudioZoneComponent::Action::Play:
            case AudioZoneComponent::Action::PlayOrTransition:
                break;
            }
        }
        z.player_inside = now_in;
    }
}

}  // namespace gseurat
