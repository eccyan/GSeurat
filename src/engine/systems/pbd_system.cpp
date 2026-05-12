#include "gseurat/engine/systems/pbd_system.hpp"

#include <algorithm>

namespace gseurat::systems {

void PbdSystem::push_splats(const Gaussian* data, std::size_t count) {
    if (data == nullptr || count == 0) return;
    pending_.insert(pending_.end(), data, data + count);
}

uint32_t PbdSystem::update_per_frame(FrameIndex frame_idx) {
    if (render_state_ == nullptr) {
        pending_.clear();
        return 0;
    }
    auto writer = render_state_->pbd_writer(frame_idx);
    const uint32_t cap = writer.capacity();
    const uint32_t count = static_cast<uint32_t>(pending_.size());
    const uint32_t live = std::min(count, cap);
    for (uint32_t i = 0; i < live; ++i) {
        GpuGaussian packed{};
        encode_gaussian(pending_[i], packed);
        writer.write_at(i, &packed, sizeof(GpuGaussian));
    }
    pending_.clear();
    return live;
}

}  // namespace gseurat::systems
