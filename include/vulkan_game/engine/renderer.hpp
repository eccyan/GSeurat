#pragma once

#include "vulkan_game/engine/buffer.hpp"
#include "vulkan_game/engine/camera.hpp"
#include "vulkan_game/engine/command_pool.hpp"
#include "vulkan_game/engine/descriptor.hpp"
#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/post_process.hpp"
#include "vulkan_game/engine/render_pass.hpp"
#include "vulkan_game/engine/resource_handle.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"
#include "vulkan_game/engine/swapchain.hpp"
#include "vulkan_game/engine/sync.hpp"
#include "vulkan_game/engine/texture.hpp"
#include "vulkan_game/engine/types.hpp"
#include "vulkan_game/engine/feature_flags.hpp"
#include "vulkan_game/engine/ui/ui_context.hpp"
#include "vulkan_game/engine/vk_context.hpp"

#include <array>
#include <string>
#include <vector>

struct GLFWwindow;

namespace vulkan_game {

class ResourceManager;

class Renderer {
public:
    void init(GLFWwindow* window, ResourceManager& resources);
    void init_font(const FontAtlas& atlas, ResourceManager& resources);
    void init_particles(ResourceManager& resources);
    void init_backgrounds(const std::vector<ResourceHandle<Texture>>& bg_textures);
    void init_shadows(ResourceManager& resources);
    void draw_frame();
    void draw_scene(Scene& scene,
                    const std::vector<SpriteDrawInfo>& entity_sprites = {},
                    const std::vector<SpriteDrawInfo>& outline_sprites = {},
                    const std::vector<SpriteDrawInfo>& reflection_sprites = {},
                    const std::vector<SpriteDrawInfo>& shadow_sprites = {},
                    const std::vector<SpriteDrawInfo>& particles = {},
                    const std::vector<SpriteDrawInfo>& overlay = {},
                    const std::vector<ui::UIDrawBatch>& ui_batches = {},
                    const FeatureFlags& flags = {});
    void shutdown();

    Camera& camera() { return camera_; }
    const Camera& camera() const { return camera_; }

    void set_fade_amount(float f) { fade_amount_ = f; }
    float fade_amount() const { return fade_amount_; }

    void request_screenshot(const std::string& path);
    bool screenshot_write_ok() const { return screenshot_write_ok_; }
    uint32_t screenshot_width() const { return screenshot_width_; }
    uint32_t screenshot_height() const { return screenshot_height_; }

    VkContext& context() { return context_; }
    CommandPool& command_pool() { return command_pool_; }

private:
    void create_sprite_pipeline();
    void create_outline_pipeline();
    void create_ui_pipeline();
    void create_uniform_buffers();
    void update_uniform_buffer(uint32_t frame_index, const UniformBufferObject& ubo);

    VkContext context_;
    Swapchain swapchain_;
    RenderPassManager render_pass_mgr_;
    PostProcessPipeline post_process_;
    CommandPool command_pool_;
    SyncObjects sync_;
    DescriptorManager descriptors_;

    VkPipelineLayout sprite_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sprite_pipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout outline_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline outline_pipeline_ = VK_NULL_HANDLE;
    VkPipeline ui_pipeline_ = VK_NULL_HANDLE;

    SpriteBatch sprite_batch_;
    std::array<Buffer, kMaxFramesInFlight> uniform_buffers_;
    std::array<Buffer, kMaxFramesInFlight> ui_uniform_buffers_;
    ResourceHandle<Texture> test_texture_;
    ResourceHandle<Texture> tileset_texture_;
    ResourceHandle<Texture> font_texture_;
    ResourceHandle<Texture> particle_texture_;
    ResourceHandle<Texture> shadow_texture_;
    ResourceHandle<Texture> flat_normal_texture_;
    ResourceHandle<Texture> tileset_normal_texture_;
    ResourceHandle<Texture> entity_normal_texture_;
    std::vector<ResourceHandle<Texture>> bg_textures_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tilemap_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> font_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> ui_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> particle_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> shadow_descriptor_sets_{};
    std::vector<std::array<VkDescriptorSet, kMaxFramesInFlight>> bg_descriptor_sets_;
    Camera camera_;
    float fade_amount_ = 0.0f;

    uint32_t current_frame_ = 0;
    uint32_t acquire_semaphore_index_ = 0;
    float last_time_ = 0.0f;
    bool font_initialized_ = false;

    // Screenshot capture
    std::string screenshot_path_;
    Buffer screenshot_staging_buffer_;
    bool screenshot_buffer_initialized_ = false;
    bool screenshot_write_ok_ = false;
    uint32_t screenshot_width_ = 0;
    uint32_t screenshot_height_ = 0;
};

}  // namespace vulkan_game
