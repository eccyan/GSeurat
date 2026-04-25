#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/collision_gen.hpp"

namespace gseurat::coord {

// ── Grid ↔ World ──

WorldPos to_world(GridPos pos, const AABB& terrain_aabb) {
    return WorldPos(pos.vec() + terrain_aabb.min);
}

GridPos to_grid(WorldPos pos, const AABB& terrain_aabb) {
    return GridPos(pos.vec() - terrain_aabb.min);
}

// ── CellIndex ↔ World ──

WorldPos to_world(CellPos cell, const CollisionGrid& grid, const AABB& terrain_aabb) {
    float world_x = cell.x() * grid.cell_size + terrain_aabb.min.x;
    float world_z = cell.z() * grid.cell_size + terrain_aabb.min.z;

    // Y is not available from the grid; callers that need terrain Y should
    // sample the HeightfieldComponent after this conversion.
    float world_y = 0.0f;

    return WorldPos(world_x, world_y, world_z);
}

CellPos to_cell(WorldPos pos, const CollisionGrid& grid, const AABB& terrain_aabb) {
    float gx = (pos.x() - terrain_aabb.min.x) / grid.cell_size;
    float gz = (pos.z() - terrain_aabb.min.z) / grid.cell_size;
    return CellPos(static_cast<float>(static_cast<int>(gx)), 0.0f,
                   static_cast<float>(static_cast<int>(gz)));
}

// ── Phase 2 stubs (implemented when subsystems are migrated) ──

WorldPos to_world(LocalPos pos, const glm::mat4& model_transform) {
    return WorldPos(glm::vec3(model_transform * glm::vec4(pos.vec(), 1.0f)));
}

LocalPos to_local(WorldPos pos, const glm::mat4& inv_model_transform) {
    return LocalPos(glm::vec3(inv_model_transform * glm::vec4(pos.vec(), 1.0f)));
}

WorldPos to_world(CameraPos pos, const glm::mat4& inv_view) {
    return WorldPos(glm::vec3(inv_view * glm::vec4(pos.vec(), 1.0f)));
}

CameraPos to_camera(WorldPos pos, const glm::mat4& view) {
    return CameraPos(glm::vec3(view * glm::vec4(pos.vec(), 1.0f)));
}

WorldPos to_world(ScreenPos pos, const glm::mat4& inv_vp, uint32_t viewport_w, uint32_t viewport_h) {
    float ndc_x = (2.0f * pos.x() / static_cast<float>(viewport_w)) - 1.0f;
    float ndc_y = (2.0f * pos.y() / static_cast<float>(viewport_h)) - 1.0f;
    glm::vec4 clip(ndc_x, ndc_y, pos.z(), 1.0f);
    glm::vec4 world = inv_vp * clip;
    world /= world.w;
    return WorldPos(glm::vec3(world));
}

ScreenPos to_screen(WorldPos pos, const glm::mat4& vp, uint32_t viewport_w, uint32_t viewport_h) {
    glm::vec4 clip = vp * glm::vec4(pos.vec(), 1.0f);
    clip /= clip.w;
    float sx = (clip.x + 1.0f) * 0.5f * static_cast<float>(viewport_w);
    float sy = (clip.y + 1.0f) * 0.5f * static_cast<float>(viewport_h);
    return ScreenPos(sx, sy, clip.z);
}

}  // namespace gseurat::coord
