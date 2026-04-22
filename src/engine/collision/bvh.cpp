#include "gseurat/engine/collision/bvh.hpp"
#include <algorithm>
#include <limits>
#include <numeric>

namespace gseurat {

void BVH::build(const std::vector<AABB>& aabbs, std::vector<uint32_t>& indices) {
    nodes_.clear();
    if (indices.empty()) return;
    // Reserve reasonable space
    nodes_.reserve(indices.size() * 2);
    build_recursive(aabbs, indices, 0, static_cast<uint32_t>(indices.size()));
}

uint32_t BVH::build_recursive(const std::vector<AABB>& aabbs,
                               std::vector<uint32_t>& indices,
                               uint32_t begin, uint32_t end) {
    // Compute parent AABB
    AABB bounds;
    bounds.min = glm::vec3(std::numeric_limits<float>::max());
    bounds.max = glm::vec3(std::numeric_limits<float>::lowest());
    for (uint32_t i = begin; i < end; ++i) {
        const auto& aabb = aabbs[indices[i]];
        bounds.min = glm::min(bounds.min, aabb.min);
        bounds.max = glm::max(bounds.max, aabb.max);
    }

    uint32_t count = end - begin;

    // Leaf node
    if (count <= MAX_LEAF_SIZE) {
        uint32_t node_idx = static_cast<uint32_t>(nodes_.size());
        nodes_.push_back(BVHNode{bounds, begin, count, true});
        return node_idx;
    }

    // Split axis = longest axis of bounds
    uint32_t axis = bounds.longest_axis();

    // Median split using nth_element
    uint32_t mid = (begin + end) / 2;
    std::nth_element(
        indices.begin() + begin,
        indices.begin() + mid,
        indices.begin() + end,
        [&](uint32_t a, uint32_t b) {
            return aabbs[a].center()[axis] < aabbs[b].center()[axis];
        });

    // Create internal node (placeholder)
    uint32_t node_idx = static_cast<uint32_t>(nodes_.size());
    nodes_.push_back(BVHNode{bounds, 0, 0, false});

    // Recurse
    uint32_t left_idx  = build_recursive(aabbs, indices, begin, mid);
    uint32_t right_idx = build_recursive(aabbs, indices, mid, end);

    nodes_[node_idx].left  = left_idx;
    nodes_[node_idx].right = right_idx;

    return node_idx;
}

void BVH::query_aabb(const AABB& query, const std::vector<AABB>& aabbs,
                     const std::vector<uint32_t>& indices,
                     std::vector<uint32_t>& out) const {
    if (nodes_.empty()) return;

    // Stack-based traversal (avoid recursion overhead)
    uint32_t stack[64];
    int top = 0;
    stack[top++] = 0;  // Push root

    while (top > 0) {
        uint32_t idx = stack[--top];
        const auto& node = nodes_[idx];

        // Test query against node bounds
        if (query.max.x < node.bounds.min.x || query.min.x > node.bounds.max.x ||
            query.max.y < node.bounds.min.y || query.min.y > node.bounds.max.y ||
            query.max.z < node.bounds.min.z || query.min.z > node.bounds.max.z) {
            continue;  // No overlap
        }

        if (node.is_leaf) {
            // Test each collider AABB individually against the query
            for (uint32_t i = node.left; i < node.left + node.right; ++i) {
                const auto& a = aabbs[indices[i]];
                if (query.max.x >= a.min.x && query.min.x <= a.max.x &&
                    query.max.y >= a.min.y && query.min.y <= a.max.y &&
                    query.max.z >= a.min.z && query.min.z <= a.max.z) {
                    out.push_back(indices[i]);
                }
            }
        } else {
            // Push children
            stack[top++] = node.left;
            stack[top++] = node.right;
        }
    }
}

// Helper: ray-AABB slab test returning entry t (or negative if miss)
static float ray_aabb_t(const glm::vec3& origin, const glm::vec3& inv_dir, const AABB& aabb) {
    glm::vec3 t1 = (aabb.min - origin) * inv_dir;
    glm::vec3 t2 = (aabb.max - origin) * inv_dir;
    glm::vec3 tmin_v = glm::min(t1, t2);
    glm::vec3 tmax_v = glm::max(t1, t2);
    float tmin = std::max({tmin_v.x, tmin_v.y, tmin_v.z});
    float tmax = std::min({tmax_v.x, tmax_v.y, tmax_v.z});
    if (tmax < 0 || tmin > tmax) return -1.0f;
    return tmin >= 0 ? tmin : tmax;
}

std::optional<std::pair<uint32_t, float>> BVH::raycast(
    const glm::vec3& origin, const glm::vec3& inv_dir, float max_t,
    const std::vector<AABB>& aabbs, const std::vector<uint32_t>& indices) const
{
    if (nodes_.empty()) return std::nullopt;

    float    best_t   = max_t;
    uint32_t best_idx = UINT32_MAX;

    uint32_t stack[64];
    int top = 0;
    stack[top++] = 0;

    while (top > 0) {
        uint32_t nidx = stack[--top];
        const auto& node = nodes_[nidx];

        float entry_t = ray_aabb_t(origin, inv_dir, node.bounds);
        if (entry_t < 0 || entry_t > best_t) continue;

        if (node.is_leaf) {
            for (uint32_t i = node.left; i < node.left + node.right; ++i) {
                float t = ray_aabb_t(origin, inv_dir, aabbs[indices[i]]);
                if (t >= 0 && t < best_t) {
                    best_t   = t;
                    best_idx = indices[i];
                }
            }
        } else {
            stack[top++] = node.left;
            stack[top++] = node.right;
        }
    }

    if (best_idx == UINT32_MAX) return std::nullopt;
    return std::make_pair(best_idx, best_t);
}

}  // namespace gseurat
