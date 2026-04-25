#pragma once

#include "gseurat/engine/ecs/components/heightfield_component.hpp"

#include <string>

namespace gseurat {

/// Load a 16-bit grayscale PNG into HeightfieldData.
/// Throws std::runtime_error on failure (wrong format, missing file).
HeightfieldData load_heightfield(const std::string& path);

}  // namespace gseurat
