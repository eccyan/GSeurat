#pragma once
#include <cstdint>
#include <functional>
#include <memory>

namespace gseurat::audio {

class IAudioDevice {
public:
    using RenderFn = std::function<void(float* interleaved_out, uint32_t frames)>;
    virtual ~IAudioDevice() = default;
    virtual bool start(uint32_t sample_rate, uint32_t channels,
                       uint32_t buffer_frames, RenderFn render) = 0;
    virtual void stop() = 0;
};

std::unique_ptr<IAudioDevice> make_miniaudio_device();

}  // namespace gseurat::audio
