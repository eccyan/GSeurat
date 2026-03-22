#include "gseurat/engine/pathfinder.hpp"

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdint>
#include <queue>
#include <vector>

namespace gseurat {

glm::ivec2 Pathfinder::world_to_grid(glm::vec2 world_pos, const TileLayer& layer) {
    const float half_w = static_cast<float>(layer.width) * layer.tile_size * 0.5f;
    const float half_h = static_cast<float>(layer.height) * layer.tile_size * 0.5f;
    int col = static_cast<int>(std::floor((world_pos.x + half_w) / layer.tile_size));
    int row = static_cast<int>(std::floor((half_h - world_pos.y) / layer.tile_size));
    return {col, row};
}

glm::vec2 Pathfinder::grid_to_world(glm::ivec2 grid_pos, const TileLayer& layer) {
    const float half_w = static_cast<float>(layer.width) * layer.tile_size * 0.5f;
    const float half_h = static_cast<float>(layer.height) * layer.tile_size * 0.5f;
    float x = (static_cast<float>(grid_pos.x) + 0.5f) * layer.tile_size - half_w;
    float y = -(static_cast<float>(grid_pos.y) + 0.5f) * layer.tile_size + half_h;
    return {x, y};
}

std::vector<glm::vec2> Pathfinder::find_path(const TileLayer& layer,
                                              glm::vec2 start_world,
                                              glm::vec2 goal_world) {
    const auto start = world_to_grid(start_world, layer);
    const auto goal = world_to_grid(goal_world, layer);

    const int w = static_cast<int>(layer.width);
    const int h = static_cast<int>(layer.height);

    // Clamp to grid bounds
    auto in_bounds = [&](int col, int row) {
        return col >= 0 && col < w && row >= 0 && row < h;
    };

    if (!in_bounds(start.x, start.y) || !in_bounds(goal.x, goal.y)) {
        return {};
    }

    auto is_solid = [&](int col, int row) -> bool {
        if (layer.solid.empty()) return false;
        uint32_t idx = static_cast<uint32_t>(row * w + col);
        if (idx >= layer.solid.size()) return false;
        return layer.solid[idx];
    };

    if (is_solid(goal.x, goal.y)) {
        return {};
    }

    const int total = w * h;
    auto idx = [&](int col, int row) { return row * w + col; };

    // f = g + h
    struct Node {
        int col, row;
        int f;
        bool operator>(const Node& o) const { return f > o.f; }
    };

    std::vector<int> g_cost(total, INT32_MAX);
    std::vector<bool> closed(total, false);
    std::vector<int> came_from(total, -1);

    auto heuristic = [&](int col, int row) {
        return std::abs(col - goal.x) + std::abs(row - goal.y);
    };

    std::priority_queue<Node, std::vector<Node>, std::greater<Node>> open;

    int si = idx(start.x, start.y);
    g_cost[si] = 0;
    open.push({start.x, start.y, heuristic(start.x, start.y)});

    constexpr int dx[] = {0, 0, -1, 1};
    constexpr int dy[] = {-1, 1, 0, 0};

    while (!open.empty()) {
        auto cur = open.top();
        open.pop();

        int ci = idx(cur.col, cur.row);
        if (closed[ci]) continue;
        closed[ci] = true;

        if (cur.col == goal.x && cur.row == goal.y) {
            // Reconstruct path
            std::vector<glm::vec2> path;
            int pi = ci;
            while (pi != si) {
                int c = pi % w;
                int r = pi / w;
                path.push_back(grid_to_world({c, r}, layer));
                pi = came_from[pi];
            }
            std::reverse(path.begin(), path.end());
            return path;
        }

        for (int d = 0; d < 4; ++d) {
            int nc = cur.col + dx[d];
            int nr = cur.row + dy[d];
            if (!in_bounds(nc, nr)) continue;
            if (is_solid(nc, nr)) continue;
            int ni = idx(nc, nr);
            if (closed[ni]) continue;

            int new_g = g_cost[ci] + 1;
            if (new_g < g_cost[ni]) {
                g_cost[ni] = new_g;
                came_from[ni] = ci;
                open.push({nc, nr, new_g + heuristic(nc, nr)});
            }
        }
    }

    return {};  // no path found
}

std::vector<glm::vec2> Pathfinder::find_path_grid(
    const CollisionGrid& grid,
    glm::vec2 world_origin,
    glm::vec2 start_world,
    glm::vec2 goal_world) {

    int w = static_cast<int>(grid.width);
    int h = static_cast<int>(grid.height);
    float cs = grid.cell_size;

    auto to_grid = [&](glm::vec2 wp) -> glm::ivec2 {
        return {static_cast<int>((wp.x - world_origin.x) / cs),
                static_cast<int>((wp.y - world_origin.y) / cs)};
    };
    auto to_world = [&](int gx, int gz) -> glm::vec2 {
        return {world_origin.x + (static_cast<float>(gx) + 0.5f) * cs,
                world_origin.y + (static_cast<float>(gz) + 0.5f) * cs};
    };
    auto in_bounds = [&](int x, int z) { return x >= 0 && x < w && z >= 0 && z < h; };
    auto idx = [&](int x, int z) { return z * w + x; };

    auto sg = to_grid(start_world);
    auto gg = to_grid(goal_world);
    if (!in_bounds(sg.x, sg.y) || !in_bounds(gg.x, gg.y)) return {};
    if (grid.is_solid(static_cast<uint32_t>(gg.x), static_cast<uint32_t>(gg.y))) return {};

    int total = w * h;
    struct Node { int x, z, f; };
    auto cmp = [](const Node& a, const Node& b) { return a.f > b.f; };
    std::priority_queue<Node, std::vector<Node>, decltype(cmp)> open(cmp);

    std::vector<int> g_cost(total, INT_MAX);
    std::vector<int> came_from(total, -1);
    std::vector<bool> closed(total, false);

    int si = idx(sg.x, sg.y);
    g_cost[si] = 0;
    auto heuristic = [&](int x, int z) { return std::abs(x - gg.x) + std::abs(z - gg.y); };
    open.push({sg.x, sg.y, heuristic(sg.x, sg.y)});

    constexpr int dx[] = {0, 0, -1, 1};
    constexpr int dz[] = {-1, 1, 0, 0};

    while (!open.empty()) {
        auto cur = open.top();
        open.pop();
        int ci = idx(cur.x, cur.z);
        if (closed[ci]) continue;
        closed[ci] = true;

        if (cur.x == gg.x && cur.z == gg.y) {
            std::vector<glm::vec2> path;
            int i = ci;
            while (i != si) {
                int gx = i % w, gz = i / w;
                path.push_back(to_world(gx, gz));
                i = came_from[i];
            }
            std::reverse(path.begin(), path.end());
            return path;
        }

        for (int d = 0; d < 4; ++d) {
            int nx = cur.x + dx[d];
            int nz = cur.z + dz[d];
            if (!in_bounds(nx, nz)) continue;
            if (grid.is_solid(static_cast<uint32_t>(nx), static_cast<uint32_t>(nz))) continue;
            int ni = idx(nx, nz);
            if (closed[ni]) continue;

            int new_g = g_cost[ci] + 1;
            if (new_g < g_cost[ni]) {
                g_cost[ni] = new_g;
                came_from[ni] = ci;
                open.push({nx, nz, new_g + heuristic(nx, nz)});
            }
        }
    }

    return {};
}

}  // namespace gseurat
