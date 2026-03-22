#pragma once

#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/tilemap.hpp"

#include <glm/glm.hpp>

#include <vector>

namespace gseurat {

namespace Pathfinder {

glm::ivec2 world_to_grid(glm::vec2 world_pos, const TileLayer& layer);
glm::vec2 grid_to_world(glm::ivec2 grid_pos, const TileLayer& layer);

// Returns world-space waypoints (tile centers) from start to goal, excluding
// start tile. Returns empty vector if no path exists.
std::vector<glm::vec2> find_path(const TileLayer& layer,
                                 glm::vec2 start_world,
                                 glm::vec2 goal_world);

// A* pathfinding on CollisionGrid (for GS scenes without tilemap).
// world_origin is the min XZ corner of the grid in world space.
std::vector<glm::vec2> find_path_grid(
    const CollisionGrid& grid,
    glm::vec2 world_origin,
    glm::vec2 start_world,
    glm::vec2 goal_world);

}  // namespace Pathfinder

}  // namespace gseurat
