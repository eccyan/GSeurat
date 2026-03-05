#pragma once

#include "vulkan_game/engine/tilemap.hpp"

#include <glm/glm.hpp>

#include <vector>

namespace vulkan_game {

namespace Pathfinder {

glm::ivec2 world_to_grid(glm::vec2 world_pos, const TileLayer& layer);
glm::vec2 grid_to_world(glm::ivec2 grid_pos, const TileLayer& layer);

// Returns world-space waypoints (tile centers) from start to goal, excluding
// start tile. Returns empty vector if no path exists.
std::vector<glm::vec2> find_path(const TileLayer& layer,
                                 glm::vec2 start_world,
                                 glm::vec2 goal_world);

}  // namespace Pathfinder

}  // namespace vulkan_game
