// Test: StateVariableFilter — LPF passes DC, HPF blocks DC, bypass at 20kHz, denormal safety.
#include "state_variable_filter.hpp"

#include <cmath>
#include <cstdio>
#include <vector>

using gseurat::audio::StateVariableFilter;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}
static bool approx(float a, float b, float eps = 5e-2f) { return std::fabs(a - b) < eps; }

int main() {
    std::printf("\n=== StateVariableFilter Tests ===\n\n");

    constexpr float SR = 44100.0f;
    constexpr uint32_t N = 4096;

    // --- LPF passes DC (0 Hz signal) ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::LPF, 1000.0f, 0.707f);
        std::vector<float> buf(N, 0.5f);
        f.process(buf, 1);
        check(approx(buf[N - 1], 0.5f), "LPF@1kHz passes DC (0 Hz)");
    }

    // --- HPF blocks DC ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::HPF, 5000.0f, 0.707f);
        std::vector<float> buf(N, 0.5f);
        f.process(buf, 1);
        check(approx(buf[N - 1], 0.0f), "HPF@5kHz blocks DC");
    }

    // --- BPF blocks DC ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::BPF, 5000.0f, 0.707f);
        std::vector<float> buf(N, 0.5f);
        f.process(buf, 1);
        check(approx(buf[N - 1], 0.0f), "BPF@5kHz blocks DC");
    }

    // --- LPF at 20kHz is transparent ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::LPF, 20000.0f, 0.707f);
        std::vector<float> buf(N, 0.5f);
        f.process(buf, 1);
        check(approx(buf[N - 1], 0.5f), "LPF@20kHz transparent");
    }

    // --- set_parameter changes cutoff ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::LPF, 20000.0f, 0.707f);
        f.set_parameter(StateVariableFilter::kParamCutoff, 200.0f);
        std::vector<float> buf(N, 0.5f);
        f.process(buf, 1);
        check(approx(buf[N - 1], 0.5f), "set_parameter cutoff 200Hz: LPF still passes DC");
    }

    // --- Denormal safety: impulse then silence ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::LPF, 1000.0f, 0.707f);
        std::vector<float> buf(N, 0.0f);
        buf[0] = 1.0f;
        f.process(buf, 1);
        check(std::abs(buf[N - 1]) < 1e-10f, "denormal: output near zero after impulse");

        std::vector<float> silence(N, 0.0f);
        f.process(silence, 1);
        check(std::abs(silence[N - 1]) < 1e-15f, "denormal: zero after extended silence");
    }

    // --- Stereo: both channels processed independently ---
    {
        StateVariableFilter f(SR, StateVariableFilter::Type::HPF, 5000.0f, 0.707f);
        std::vector<float> buf(N * 2);
        for (uint32_t i = 0; i < N; ++i) {
            buf[i * 2 + 0] = 0.5f;
            buf[i * 2 + 1] = 0.0f;
        }
        f.process(buf, 2);
        check(approx(buf[(N - 1) * 2 + 0], 0.0f), "stereo L: HPF blocks DC");
        check(approx(buf[(N - 1) * 2 + 1], 0.0f), "stereo R: silence stays silent");
    }

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
