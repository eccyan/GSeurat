// NOTE: MINIAUDIO_IMPLEMENTATION is in memory_audio_source.cpp.
// This file only uses the miniaudio API (header-only portion).
#include <miniaudio.h>

#include "miniaudio_device.hpp"
#include <memory>

namespace gseurat::audio {

class MiniaudioDevice : public IAudioDevice {
    ma_device device_{};
    bool      running_ = false;
    RenderFn  render_;

    static void data_cb(ma_device* d, void* output, const void*, ma_uint32 frames) {
        auto* self = static_cast<MiniaudioDevice*>(d->pUserData);
        self->render_(static_cast<float*>(output), frames);
    }

public:
    bool start(uint32_t sr, uint32_t ch, uint32_t buf, RenderFn render) override {
        if (running_) return true;
        render_ = std::move(render);
        ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
        cfg.playback.format    = ma_format_f32;
        cfg.playback.channels  = ch;
        cfg.sampleRate         = sr;
        cfg.periodSizeInFrames = buf;
        cfg.dataCallback       = data_cb;
        cfg.pUserData          = this;
        if (ma_device_init(nullptr, &cfg, &device_) != MA_SUCCESS) return false;
        if (ma_device_start(&device_) != MA_SUCCESS) {
            ma_device_uninit(&device_);
            return false;
        }
        running_ = true;
        return true;
    }

    void stop() override {
        if (running_) { ma_device_uninit(&device_); running_ = false; }
    }

    ~MiniaudioDevice() override { stop(); }
};

std::unique_ptr<IAudioDevice> make_miniaudio_device() {
    return std::make_unique<MiniaudioDevice>();
}

}  // namespace gseurat::audio
