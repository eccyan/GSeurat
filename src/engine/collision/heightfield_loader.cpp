#include "gseurat/engine/collision/heightfield_loader.hpp"

#include <stb_image.h>

#include <cstdio>
#include <stdexcept>
#include <string>

namespace gseurat {

HeightfieldData load_heightfield(const std::string& path) {
    int w = 0, h = 0, channels = 0;
    stbi_us* pixels = stbi_load_16(path.c_str(), &w, &h, &channels, 1);

    if (!pixels) {
        throw std::runtime_error(
            "Failed to load heightfield: " + path + " — " + stbi_failure_reason());
    }

    if (w <= 0 || h <= 0) {
        stbi_image_free(pixels);
        throw std::runtime_error(
            "Heightfield has zero dimensions: " + path);
    }

    HeightfieldData data;
    data.img_width  = static_cast<uint32_t>(w);
    data.img_height = static_cast<uint32_t>(h);
    data.samples.assign(pixels, pixels + static_cast<size_t>(w) * h);

    stbi_image_free(pixels);

    std::fprintf(stderr, "[Physics] Loaded heightfield: %s (%ux%u)\n",
                 path.c_str(), data.img_width, data.img_height);

    return data;
}

}  // namespace gseurat
