#pragma once

namespace gseurat {

enum class Direction { Down, Left, Right, Up };

inline const char* direction_suffix(Direction dir) {
    switch (dir) {
        case Direction::Down:  return "down";
        case Direction::Left:  return "left";
        case Direction::Right: return "right";
        case Direction::Up:    return "up";
    }
    return "down";
}

}  // namespace gseurat
