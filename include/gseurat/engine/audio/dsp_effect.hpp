#pragma once
#include <cstdint>
#include <span>

namespace gseurat::audio {

class IDSPEffect {
public:
    virtual ~IDSPEffect() = default;
    virtual void process(std::span<float> inout, uint32_t channels) noexcept = 0;
    virtual void set_parameter(uint32_t id, float value) noexcept = 0;
};

}  // namespace gseurat::audio
