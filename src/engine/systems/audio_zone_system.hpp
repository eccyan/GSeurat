#pragma once
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/components/audio_zone_component.hpp"
#include <glm/glm.hpp>
#include <span>

namespace gseurat {

class AudioZoneSystem {
    audio::AudioEngine* engine_;
public:
    explicit AudioZoneSystem(audio::AudioEngine* e) : engine_(e) {}
    void tick(glm::vec3 player_pos, std::span<AudioZoneComponent> zones);
};

}  // namespace gseurat
