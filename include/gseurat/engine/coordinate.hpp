#pragma once

#include <glm/glm.hpp>

#include <cstdint>
#include <type_traits>

namespace gseurat {

// Forward declarations for conversion context types
struct AABB;
struct CollisionGrid;

namespace coord {

// Tag types — empty structs, zero runtime cost
struct Grid {};       // Bricklayer 0-based scene JSON coordinates
struct World {};      // PLY / rendering world space
struct CellIndex {};  // Integer collision grid indices (gx, gz)
struct Local {};      // Per-object model space (before transform)
struct Camera {};     // View space (GS parallax, orbit camera)
struct Screen {};     // Pixel coordinates (UI, mouse)

template <typename Space>
class Position {
public:
    Position() = default;
    explicit Position(glm::vec3 v) : v_(v) {}
    explicit Position(float x, float y, float z) : v_(x, y, z) {}

    const glm::vec3& vec() const { return v_; }
    glm::vec3& vec() { return v_; }

    float x() const { return v_.x; }
    float y() const { return v_.y; }
    float z() const { return v_.z; }

    Position operator+(const Position& rhs) const { return Position(v_ + rhs.v_); }
    Position operator-(const Position& rhs) const { return Position(v_ - rhs.v_); }
    Position& operator+=(const Position& rhs) { v_ += rhs.v_; return *this; }
    Position& operator-=(const Position& rhs) { v_ -= rhs.v_; return *this; }

    bool operator==(const Position& rhs) const { return v_ == rhs.v_; }
    bool operator!=(const Position& rhs) const { return v_ != rhs.v_; }

private:
    glm::vec3 v_{0.0f};
};

// Convenience aliases
using GridPos   = Position<Grid>;
using WorldPos  = Position<World>;
using CellPos   = Position<CellIndex>;
using LocalPos  = Position<Local>;
using CameraPos = Position<Camera>;
using ScreenPos = Position<Screen>;

// ── Conversion declarations (Phase 1: Grid↔World, Cell↔World) ──

WorldPos to_world(GridPos pos, const AABB& terrain_aabb);
GridPos  to_grid(WorldPos pos, const AABB& terrain_aabb);

WorldPos to_world(CellPos cell, const CollisionGrid& grid, const AABB& terrain_aabb);
CellPos  to_cell(WorldPos pos, const CollisionGrid& grid, const AABB& terrain_aabb);

// ── Phase 2 declarations (implemented when subsystems are migrated) ──

WorldPos  to_world(LocalPos pos, const glm::mat4& model_transform);
LocalPos  to_local(WorldPos pos, const glm::mat4& inv_model_transform);

WorldPos  to_world(CameraPos pos, const glm::mat4& inv_view);
CameraPos to_camera(WorldPos pos, const glm::mat4& view);

WorldPos  to_world(ScreenPos pos, const glm::mat4& inv_vp, uint32_t viewport_w, uint32_t viewport_h);
ScreenPos to_screen(WorldPos pos, const glm::mat4& vp, uint32_t viewport_w, uint32_t viewport_h);

}  // namespace coord
}  // namespace gseurat
