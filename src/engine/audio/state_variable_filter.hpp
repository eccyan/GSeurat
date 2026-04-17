#pragma once
#include "gseurat/engine/audio/dsp_effect.hpp"
#include <array>
#include <cmath>
#include <cstdint>

namespace gseurat::audio {

class StateVariableFilter final : public IDSPEffect {
public:
    enum class Type : uint8_t { LPF, HPF, BPF };

    static constexpr uint32_t kParamCutoff    = 0;  // Hz [20, 20000]
    static constexpr uint32_t kParamResonance = 1;  // Q  [0.5, 20]
    static constexpr uint32_t kParamType      = 2;  // 0=LPF, 1=HPF, 2=BPF

    StateVariableFilter(float sample_rate, Type type = Type::LPF,
                         float cutoff_hz = 20000.0f, float resonance = 0.707f);

    void process(std::span<float> inout, uint32_t channels) noexcept override;
    void set_parameter(uint32_t id, float value) noexcept override;

    float cutoff()    const noexcept { return cutoff_hz_; }
    float resonance() const noexcept { return resonance_; }
    Type  type()      const noexcept { return type_; }

private:
    float sample_rate_;
    Type  type_;
    float cutoff_hz_;
    float resonance_;

    float g_  = 0.0f;
    float k_  = 0.0f;
    float a1_ = 0.0f;
    float a2_ = 0.0f;
    float a3_ = 0.0f;

    struct ChannelState { float ic1eq = 0.0f, ic2eq = 0.0f; };
    std::array<ChannelState, 2> state_{};

    void recompute_coefficients() noexcept;
};

}  // namespace gseurat::audio
