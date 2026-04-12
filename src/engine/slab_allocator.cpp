#include "gseurat/engine/slab_allocator.hpp"
#include <string>

namespace gseurat {

SlabAllocator::SlabAllocator(uint32_t total_slabs, uint32_t splats_per_slab)
    : total_slabs_(total_slabs), splats_per_slab_(splats_per_slab),
      in_use_(total_slabs, false) {
    free_list_.reserve(total_slabs);
    for (uint32_t i = total_slabs; i > 0; --i) {
        free_list_.push_back(i - 1);
    }
}

SlabAllocator::SlabHandle SlabAllocator::checkout(uint32_t slab_count) {
    if (slab_count > free_list_.size()) {
        throw std::runtime_error("SlabAllocator: not enough free slabs ("
            + std::to_string(free_list_.size()) + " available, "
            + std::to_string(slab_count) + " requested)");
    }
    SlabHandle handle;
    handle.chunk_id = next_chunk_id_++;
    handle.slab_indices.reserve(slab_count);
    for (uint32_t i = 0; i < slab_count; ++i) {
        uint32_t idx = free_list_.back();
        free_list_.pop_back();
        in_use_[idx] = true;
        handle.slab_indices.push_back(idx);
    }
    return handle;
}

void SlabAllocator::release(const SlabHandle& handle) {
    for (auto idx : handle.slab_indices) {
        if (idx < total_slabs_ && in_use_[idx]) {
            in_use_[idx] = false;
            free_list_.push_back(idx);
        }
    }
}

uint32_t SlabAllocator::available() const {
    return static_cast<uint32_t>(free_list_.size());
}

}  // namespace gseurat
