#pragma once

#include <cstdint>
#include <vector>

namespace gseurat::procedural_textures {

/// Raw RGBA8 texture bytes plus dimensions, ready for GPU upload via
/// `ResourceManager::load_texture_from_memory`.
struct TextureData {
    std::vector<uint8_t> pixels;
    uint32_t width;
    uint32_t height;
};

/// 1x1 RGBA: flat tangent-space normal (128, 128, 255, 255), i.e. (0, 0, 1)
/// after the x*2-1 decode. Used as the fallback normal map for pipelines
/// that don't supply a real normal texture.
TextureData flat_normal();

/// 32x32 RGBA: white RGB with a radial Gaussian alpha falloff from the
/// center. Used as a cheap billboard blob shadow.
TextureData shadow_blob();

/// 96x16 RGBA: a 6-tile particle brush sheet. Each 16x16 tile is one
/// brush shape (circle, soft glow, spark, smoke puff, raindrop, snowflake),
/// all white RGB with varying alpha. Used as the particle/VFX atlas.
TextureData particle_atlas();

}  // namespace gseurat::procedural_textures
