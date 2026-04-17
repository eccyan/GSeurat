#pragma once
#include "gseurat/engine/audio/audio_source.hpp"
#include <atomic>
#include <cstdint>

namespace gseurat::audio {

struct OneshotVoice {
    const IAudioSource* source = nullptr;  // nullptr = free slot
    uint64_t play_cursor  = 0;
    float    volume       = 1.0f;
    bool     looping      = false;         // true = spatial looping (no auto-free)
    bool     spatial      = false;         // true = apply distance attenuation
    float    pos_x        = 0.0f;          // world position (spatial only)
    float    pos_y        = 0.0f;
    float    pos_z        = 0.0f;
    float    max_distance = 15.0f;
    uint32_t generation   = 0;             // voice handle validation
};

struct ListenerState {
    std::atomic<float> x{0.0f};
    std::atomic<float> y{0.0f};
    std::atomic<float> z{0.0f};
};

// Voice handle = (generation << 16) | pool_index
inline uint32_t make_voice_handle(uint32_t index, uint32_t gen) {
    return (gen << 16) | (index & 0xFFFF);
}
inline uint32_t voice_handle_index(uint32_t handle) { return handle & 0xFFFF; }
inline uint32_t voice_handle_generation(uint32_t handle) { return handle >> 16; }

}  // namespace gseurat::audio
