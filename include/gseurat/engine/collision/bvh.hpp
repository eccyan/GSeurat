#pragma once

#include "gseurat/engine/gaussian_cloud.hpp"  // for AABB

#include <glm/glm.hpp>

#include <cstdint>
#include <optional>
#include <utility>
#include <vector>

namespace gseurat {

struct BVHNode {
    AABB bounds;
    uint32_t left{0};     // Internal: left child index. Leaf: first collider index in sorted array.
    uint32_t right{0};    // Internal: right child index. Leaf: collider count.
    bool is_leaf{false};
};

class BVH {
public:
    static constexpr uint32_t MAX_LEAF_SIZE = 4;

    /// Build BVH over AABBs. Reorders `indices` in-place for spatial coherence.
    /// `aabbs` is indexed by values in `indices`.
    void build(const std::vector<AABB>& aabbs, std::vector<uint32_t>& indices);

    /// Query: find all indices whose AABBs overlap `query`.
    void query_aabb(const AABB& query, const std::vector<AABB>& aabbs,
                    const std::vector<uint32_t>& indices,
                    std::vector<uint32_t>& out) const;

    /// Query: raycast, return index + t of closest AABB hit.
    /// Caller does narrow-phase on the returned candidate.
    std::optional<std::pair<uint32_t, float>> raycast(
        const glm::vec3& origin, const glm::vec3& inv_dir, float max_t,
        const std::vector<AABB>& aabbs, const std::vector<uint32_t>& indices) const;

    bool empty() const { return nodes_.empty(); }
    const std::vector<BVHNode>& nodes() const { return nodes_; }
    void clear() { nodes_.clear(); }

private:
    std::vector<BVHNode> nodes_;

    uint32_t build_recursive(const std::vector<AABB>& aabbs,
                             std::vector<uint32_t>& indices,
                             uint32_t begin, uint32_t end);
};

}  // namespace gseurat
