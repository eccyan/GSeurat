#pragma once

#include "vulkan_game/engine/buffer.hpp"
#include "vulkan_game/engine/camera.hpp"
#include "vulkan_game/engine/command_pool.hpp"
#include "vulkan_game/engine/descriptor.hpp"
#include "vulkan_game/engine/font_atlas.hpp"
#include "vulkan_game/engine/render_pass.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"
#include "vulkan_game/engine/swapchain.hpp"
#include "vulkan_game/engine/sync.hpp"
#include "vulkan_game/engine/texture.hpp"
#include "vulkan_game/engine/types.hpp"
#include "vulkan_game/engine/vk_context.hpp"

#include <array>
#include <vector>

struct GLFWwindow;

namespace vulkan_game {

class Renderer {
public:
    void init(GLFWwindow* window);
    void init_font(const FontAtlas& atlas);
    void init_particles();
    void draw_frame();
    void draw_scene(Scene& scene,
                    const std::vector<SpriteDrawInfo>& particles = {},
                    const std::vector<SpriteDrawInfo>& overlay = {},
                    const std::vector<SpriteDrawInfo>& ui = {});
    void shutdown();

    Camera& camera() { return camera_; }
    const Camera& camera() const { return camera_; }

private:
    void create_sprite_pipeline();
    void create_ui_pipeline();
    void create_uniform_buffers();
    void update_uniform_buffer(uint32_t frame_index, const UniformBufferObject& ubo);

    VkContext context_;
    Swapchain swapchain_;
    RenderPassManager render_pass_mgr_;
    CommandPool command_pool_;
    SyncObjects sync_;
    DescriptorManager descriptors_;

    VkPipelineLayout sprite_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sprite_pipeline_ = VK_NULL_HANDLE;
    VkPipeline ui_pipeline_ = VK_NULL_HANDLE;

    SpriteBatch sprite_batch_;
    std::array<Buffer, kMaxFramesInFlight> uniform_buffers_;
    std::array<Buffer, kMaxFramesInFlight> ui_uniform_buffers_;
    Texture test_texture_;
    Texture tileset_texture_;
    Texture font_texture_;
    Texture particle_texture_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tilemap_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> font_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> ui_descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> particle_descriptor_sets_{};
    Camera camera_;

    uint32_t current_frame_ = 0;
    uint32_t acquire_semaphore_index_ = 0;
    float last_time_ = 0.0f;
    bool font_initialized_ = false;
};

}  // namespace vulkan_game
