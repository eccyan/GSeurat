#pragma once

#include <cstdint>
#include <stdexcept>
#include <vector>

namespace gseurat {

class SlabAllocator {
public:
    struct SlabHandle {
        uint32_t chunk_id;
        std::vector<uint32_t> slab_indices;
    };

    SlabAllocator(uint32_t total_slabs, uint32_t splats_per_slab);

    SlabHandle checkout(uint32_t slab_count);
    void release(const SlabHandle& handle);

    uint32_t available() const;
    uint32_t total_slabs() const { return total_slabs_; }
    uint32_t splats_per_slab() const { return splats_per_slab_; }

private:
    uint32_t total_slabs_;
    uint32_t splats_per_slab_;
    uint32_t next_chunk_id_{0};
    std::vector<uint32_t> free_list_;
};

}  // namespace gseurat
