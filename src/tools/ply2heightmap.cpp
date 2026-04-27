// ply2heightmap — Convert Gaussian-splat PLY point clouds to 16-bit grayscale
// PNG heightmaps for GSeurat's HeightfieldComponent.
//
// Usage: ply2heightmap <input.ply> <output.png> [--ppu N] [--padding N]
//                      [--min-opacity N] [--z-up]

#include "gseurat/engine/gaussian_cloud.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

using gseurat::AABB;
using gseurat::Gaussian;
using gseurat::GaussianCloud;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

struct HeightmapParams {
    float ppu = 2.0f;         // pixels per unit
    float padding = 1.0f;     // padding around AABB
    float min_opacity = 0.1f; // opacity filter threshold
    bool z_up = false;        // swap Y/Z on load
};

struct HeightmapResult {
    std::vector<float> grid;
    uint32_t width = 0;
    uint32_t height = 0;
    float cell_size = 0.0f;
    AABB padded_aabb;
};

struct NormResult {
    std::vector<uint16_t> pixels;
    float min_height = 0.0f;
    float max_height = 0.0f;
};

// ---------------------------------------------------------------------------
// rasterize_splats
// ---------------------------------------------------------------------------

HeightmapResult rasterize_splats(const std::vector<Gaussian>& splats,
                                 const AABB& bounds,
                                 const HeightmapParams& params) {
    HeightmapResult result;

    // Pad AABB
    AABB padded = bounds;
    glm::vec3 pad(params.padding);
    padded.min -= pad;
    padded.max += pad;
    result.padded_aabb = padded;

    float range_x = padded.max.x - padded.min.x;
    float range_z = padded.max.z - padded.min.z;

    result.width = static_cast<uint32_t>(std::ceil(range_x * params.ppu));
    result.height = static_cast<uint32_t>(std::ceil(range_z * params.ppu));
    result.cell_size = 1.0f / params.ppu;

    if (result.width == 0) result.width = 1;
    if (result.height == 0) result.height = 1;

    result.grid.assign(static_cast<size_t>(result.width) * result.height, -FLT_MAX);

    for (const auto& g : splats) {
        // Rotate scale axes by quaternion to get oriented half-extents
        glm::vec3 ax = g.rotation * glm::vec3(g.scale.x, 0.0f, 0.0f);
        glm::vec3 ay = g.rotation * glm::vec3(0.0f, g.scale.y, 0.0f);
        glm::vec3 az = g.rotation * glm::vec3(0.0f, 0.0f, g.scale.z);

        // AABB half-extents from rotated axes
        float half_x = std::abs(ax.x) + std::abs(ay.x) + std::abs(az.x);
        float half_y = std::abs(ax.y) + std::abs(ay.y) + std::abs(az.y);
        float half_z = std::abs(ax.z) + std::abs(ay.z) + std::abs(az.z);

        float top_y = g.position.y + half_y;

        // Map splat AABB to grid cells
        float min_gx = (g.position.x - half_x - padded.min.x) * params.ppu;
        float max_gx = (g.position.x + half_x - padded.min.x) * params.ppu;
        float min_gz = (g.position.z - half_z - padded.min.z) * params.ppu;
        float max_gz = (g.position.z + half_z - padded.min.z) * params.ppu;

        int ix0 = std::max(0, static_cast<int>(std::floor(min_gx)));
        int ix1 = std::min(static_cast<int>(result.width) - 1,
                           static_cast<int>(std::floor(max_gx)));
        int iz0 = std::max(0, static_cast<int>(std::floor(min_gz)));
        int iz1 = std::min(static_cast<int>(result.height) - 1,
                           static_cast<int>(std::floor(max_gz)));

        for (int iz = iz0; iz <= iz1; ++iz) {
            for (int ix = ix0; ix <= ix1; ++ix) {
                size_t idx = static_cast<size_t>(iz) * result.width + ix;
                result.grid[idx] = std::max(result.grid[idx], top_y);
            }
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// dilate_gaps — double-buffered 3x3 max dilation
// ---------------------------------------------------------------------------

void dilate_gaps(const std::vector<float>& src,
                 std::vector<float>& dst,
                 uint32_t w, uint32_t h) {
    dst = src; // copy so filled cells stay unchanged

    for (uint32_t y = 0; y < h; ++y) {
        for (uint32_t x = 0; x < w; ++x) {
            size_t idx = static_cast<size_t>(y) * w + x;
            if (src[idx] != -FLT_MAX) continue; // already filled in src

            float best = -FLT_MAX;
            for (int dy = -1; dy <= 1; ++dy) {
                for (int dx = -1; dx <= 1; ++dx) {
                    int nx = static_cast<int>(x) + dx;
                    int ny = static_cast<int>(y) + dy;
                    if (nx < 0 || nx >= static_cast<int>(w) ||
                        ny < 0 || ny >= static_cast<int>(h))
                        continue;
                    size_t nidx = static_cast<size_t>(ny) * w + nx;
                    best = std::max(best, src[nidx]);
                }
            }
            dst[idx] = best;
        }
    }
}

// ---------------------------------------------------------------------------
// normalize_to_uint16
// ---------------------------------------------------------------------------

NormResult normalize_to_uint16(const std::vector<float>& grid,
                               uint32_t w, uint32_t h) {
    NormResult result;

    float lo = FLT_MAX;
    float hi = -FLT_MAX;

    for (size_t i = 0; i < static_cast<size_t>(w) * h; ++i) {
        if (grid[i] == -FLT_MAX) continue;
        lo = std::min(lo, grid[i]);
        hi = std::max(hi, grid[i]);
    }

    // Flat-world guard
    if (hi - lo < 1e-5f) {
        hi = lo + 1.0f;
    }

    result.min_height = lo;
    result.max_height = hi;

    float range = hi - lo;
    result.pixels.resize(static_cast<size_t>(w) * h);

    for (size_t i = 0; i < static_cast<size_t>(w) * h; ++i) {
        if (grid[i] == -FLT_MAX) {
            result.pixels[i] = 0;
        } else {
            float t = (grid[i] - lo) / range;
            result.pixels[i] = static_cast<uint16_t>(
                std::lround(t * 65535.0));
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// write_png_16 — manual 16-bit grayscale PNG writer
// ---------------------------------------------------------------------------

namespace {

void png_write_u32be(uint8_t* buf, uint32_t val) {
    buf[0] = static_cast<uint8_t>((val >> 24) & 0xFF);
    buf[1] = static_cast<uint8_t>((val >> 16) & 0xFF);
    buf[2] = static_cast<uint8_t>((val >> 8) & 0xFF);
    buf[3] = static_cast<uint8_t>(val & 0xFF);
}

uint32_t png_crc32(const uint8_t* data, size_t len) {
    // CRC-32/ISO-HDLC (PNG uses this polynomial)
    static uint32_t table[256] = {};
    static bool table_init = false;
    if (!table_init) {
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int j = 0; j < 8; ++j) {
                if (c & 1)
                    c = 0xEDB88320u ^ (c >> 1);
                else
                    c >>= 1;
            }
            table[i] = c;
        }
        table_init = true;
    }
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < len; ++i) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

// Write a PNG chunk: length(4) + type(4) + data(length) + crc(4)
bool png_write_chunk(FILE* fp, const char type[4],
                     const uint8_t* data, uint32_t length) {
    uint8_t buf[4];
    png_write_u32be(buf, length);
    if (fwrite(buf, 1, 4, fp) != 4) return false;
    if (fwrite(type, 1, 4, fp) != 4) return false;
    if (length > 0 && data) {
        if (fwrite(data, 1, length, fp) != length) return false;
    }
    // CRC covers type + data
    std::vector<uint8_t> crc_buf(4 + length);
    std::memcpy(crc_buf.data(), type, 4);
    if (length > 0 && data) {
        std::memcpy(crc_buf.data() + 4, data, length);
    }
    uint32_t crc = png_crc32(crc_buf.data(), crc_buf.size());
    png_write_u32be(buf, crc);
    if (fwrite(buf, 1, 4, fp) != 4) return false;
    return true;
}

} // anonymous namespace

bool write_png_16(const char* path, const uint16_t* data,
                  uint32_t w, uint32_t h) {
    FILE* fp = fopen(path, "wb");
    if (!fp) return false;

    // PNG signature
    static const uint8_t sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    fwrite(sig, 1, 8, fp);

    // IHDR: width(4) height(4) bitdepth(1) colortype(1) compress(1) filter(1) interlace(1)
    uint8_t ihdr[13];
    png_write_u32be(ihdr, w);
    png_write_u32be(ihdr + 4, h);
    ihdr[8] = 16;  // bit depth
    ihdr[9] = 0;   // color type: grayscale
    ihdr[10] = 0;  // compression method
    ihdr[11] = 0;  // filter method
    ihdr[12] = 0;  // interlace method
    if (!png_write_chunk(fp, "IHDR", ihdr, 13)) { fclose(fp); return false; }

    // Build raw image data: for each row, 1 filter byte + w*2 bytes (big-endian)
    size_t row_bytes = 1 + static_cast<size_t>(w) * 2;
    std::vector<uint8_t> raw(row_bytes * h);
    for (uint32_t y = 0; y < h; ++y) {
        size_t row_off = y * row_bytes;
        raw[row_off] = 0; // filter byte: None
        for (uint32_t x = 0; x < w; ++x) {
            uint16_t val = data[static_cast<size_t>(y) * w + x];
            size_t px_off = row_off + 1 + static_cast<size_t>(x) * 2;
            raw[px_off] = static_cast<uint8_t>((val >> 8) & 0xFF);
            raw[px_off + 1] = static_cast<uint8_t>(val & 0xFF);
        }
    }

    // Compress with stbi_zlib_compress
    int compressed_len = 0;
    stbi_write_png_compression_level = 8;
    uint8_t* compressed = reinterpret_cast<uint8_t*>(
        stbi_zlib_compress(raw.data(),
                           static_cast<int>(raw.size()),
                           &compressed_len, 8));
    if (!compressed) {
        fclose(fp);
        return false;
    }

    bool idat_ok = png_write_chunk(fp, "IDAT", compressed,
                                    static_cast<uint32_t>(compressed_len));
    STBIW_FREE(compressed);
    if (!idat_ok) { fclose(fp); return false; }

    // IEND
    if (!png_write_chunk(fp, "IEND", nullptr, 0)) { fclose(fp); return false; }

    fclose(fp);
    return true;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

#ifndef PLY2HEIGHTMAP_NO_MAIN

int main(int argc, char* argv[]) {
    if (argc < 3) {
        fprintf(stderr,
                "Usage: ply2heightmap <input.ply> <output.png> [options]\n"
                "Options:\n"
                "  --ppu N          Pixels per unit (default: 2.0)\n"
                "  --padding N      AABB padding in units (default: 1.0)\n"
                "  --min-opacity N  Minimum opacity threshold (default: 0.1)\n"
                "  --z-up           Swap Y/Z axes (input is Z-up)\n");
        return 1;
    }

    const char* input_path = argv[1];
    const char* output_path = argv[2];

    HeightmapParams params;

    for (int i = 3; i < argc; ++i) {
        if (strcmp(argv[i], "--ppu") == 0 && i + 1 < argc) {
            params.ppu = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--padding") == 0 && i + 1 < argc) {
            params.padding = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--min-opacity") == 0 && i + 1 < argc) {
            params.min_opacity = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--z-up") == 0) {
            params.z_up = true;
        } else {
            fprintf(stderr, "Unknown option: %s\n", argv[i]);
            return 1;
        }
    }

    // Validate parameters
    if (params.ppu <= 0.0f) {
        fprintf(stderr, "Error: --ppu must be positive (got %.4f)\n", params.ppu);
        return 1;
    }
    if (params.padding < 0.0f) {
        fprintf(stderr, "Error: --padding must be non-negative (got %.4f)\n", params.padding);
        return 1;
    }

    // Load PLY
    GaussianCloud cloud;
    try {
        cloud = GaussianCloud::load_ply(input_path);
    } catch (const std::exception& e) {
        fprintf(stderr, "Error loading PLY: %s\n", e.what());
        return 1;
    }
    if (cloud.empty()) {
        fprintf(stderr, "Error: failed to load PLY or file is empty: %s\n",
                input_path);
        return 1;
    }

    fprintf(stderr, "Loaded %u Gaussians from %s\n", cloud.count(), input_path);

    // Filter by opacity and optionally swap Y/Z
    const auto& all = cloud.gaussians();
    std::vector<Gaussian> filtered;
    filtered.reserve(all.size());
    AABB bounds;

    for (const auto& g : all) {
        if (g.opacity < params.min_opacity) continue;

        Gaussian out = g;
        if (params.z_up) {
            // Swap Y and Z
            std::swap(out.position.y, out.position.z);
            std::swap(out.scale.y, out.scale.z);
            // Swap quaternion components for Y/Z swap
            out.rotation = glm::quat(g.rotation.w, g.rotation.x,
                                     g.rotation.z, g.rotation.y);
        }
        bounds.expand(out.position);
        filtered.push_back(out);
    }

    if (filtered.empty()) {
        fprintf(stderr, "Error: no Gaussians passed opacity filter (>= %.3f)\n",
                params.min_opacity);
        return 1;
    }

    fprintf(stderr, "Filtered to %zu Gaussians (opacity >= %.3f)\n",
            filtered.size(), params.min_opacity);

    // Rasterize
    HeightmapResult hm = rasterize_splats(filtered, bounds, params);
    fprintf(stderr, "Grid: %u x %u (cell_size=%.4f)\n",
            hm.width, hm.height, hm.cell_size);

    // Dilate gaps
    std::vector<float> dilated;
    dilate_gaps(hm.grid, dilated, hm.width, hm.height);

    // Normalize
    NormResult norm = normalize_to_uint16(dilated, hm.width, hm.height);

    // Write PNG
    if (!write_png_16(output_path, norm.pixels.data(), hm.width, hm.height)) {
        fprintf(stderr, "Error: failed to write PNG: %s\n", output_path);
        return 1;
    }

    // Print summary (HeightfieldComponent values)
    const AABB& pa = hm.padded_aabb;
    printf("=== ply2heightmap summary ===\n");
    printf("  input:      %s\n", input_path);
    printf("  output:     %s\n", output_path);
    printf("  dimensions: %u x %u\n", hm.width, hm.height);
    printf("  cell_size:  %.4f\n", hm.cell_size);
    printf("  min_height: %.4f\n", norm.min_height);
    printf("  max_height: %.4f\n", norm.max_height);
    printf("  padded_aabb.min: (%.4f, %.4f, %.4f)\n",
           pa.min.x, pa.min.y, pa.min.z);
    printf("  padded_aabb.max: (%.4f, %.4f, %.4f)\n",
           pa.max.x, pa.max.y, pa.max.z);
    printf("\nHeightfieldComponent JSON:\n");
    printf("  {\n");
    printf("    \"heightmap\": \"%s\",\n", output_path);
    printf("    \"offset\": [%.4f, %.4f, %.4f],\n",
           pa.min.x, norm.min_height, pa.min.z);
    printf("    \"scale\": [%.4f, %.4f, %.4f]\n",
           pa.max.x - pa.min.x, norm.max_height - norm.min_height,
           pa.max.z - pa.min.z);
    printf("  }\n");

    return 0;
}

#endif // PLY2HEIGHTMAP_NO_MAIN
