#include "state_variable_filter.hpp"
#include <algorithm>

namespace gseurat::audio {

StateVariableFilter::StateVariableFilter(float sample_rate, Type type,
                                          float cutoff_hz, float resonance)
    : sample_rate_(sample_rate), type_(type),
      cutoff_hz_(cutoff_hz), resonance_(resonance) {
    recompute_coefficients();
}

void StateVariableFilter::set_parameter(uint32_t id, float value) noexcept {
    switch (id) {
    case kParamCutoff:
        cutoff_hz_ = std::clamp(value, 20.0f, 20000.0f);
        break;
    case kParamResonance:
        resonance_ = std::clamp(value, 0.5f, 20.0f);
        break;
    case kParamType:
        type_ = static_cast<Type>(std::clamp(static_cast<int>(value), 0, 2));
        break;
    }
}

void StateVariableFilter::recompute_coefficients() noexcept {
    g_  = std::tan(3.14159265f * cutoff_hz_ / sample_rate_);
    k_  = 1.0f / resonance_;
    a1_ = 1.0f / (1.0f + g_ * (g_ + k_));
    a2_ = g_ * a1_;
    a3_ = g_ * a2_;
}

void StateVariableFilter::process(std::span<float> inout, uint32_t channels) noexcept {
    recompute_coefficients();

    const uint32_t ch = std::min(channels, 2u);
    const uint32_t frames = static_cast<uint32_t>(inout.size()) / ch;

    for (uint32_t f = 0; f < frames; ++f) {
        for (uint32_t c = 0; c < ch; ++c) {
            auto& s = state_[c];
            const float v0 = inout[f * ch + c];
            const float v3 = v0 - s.ic2eq;
            const float v1 = a1_ * s.ic1eq + a2_ * v3;
            const float v2 = s.ic2eq + a2_ * s.ic1eq + a3_ * v3;

            s.ic1eq = 2.0f * v1 - s.ic1eq;
            s.ic2eq = 2.0f * v2 - s.ic2eq;

            // Software FTZ — portable denormal protection
            // TODO(Phase 3): Replace with hardware DAZ/FTZ flags on the audio thread
            if (std::abs(s.ic1eq) < 1e-15f) s.ic1eq = 0.0f;
            if (std::abs(s.ic2eq) < 1e-15f) s.ic2eq = 0.0f;

            float out;
            switch (type_) {
            case Type::LPF: out = v2; break;
            case Type::HPF: out = v0 - k_ * v1 - v2; break;
            case Type::BPF: out = v1; break;
            default:        out = v0; break;
            }
            inout[f * ch + c] = out;
        }
    }
}

}  // namespace gseurat::audio
