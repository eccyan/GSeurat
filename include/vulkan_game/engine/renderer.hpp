#pragma once

#include "vulkan_game/engine/buffer.hpp"
#include "vulkan_game/engine/camera.hpp"
#include "vulkan_game/engine/command_pool.hpp"
#include "vulkan_game/engine/descriptor.hpp"
#include "vulkan_game/engine/render_pass.hpp"
#include "vulkan_game/engine/scene.hpp"
#include "vulkan_game/engine/sprite_batch.hpp"
#include "vulkan_game/engine/swapchain.hpp"
#include "vulkan_game/engine/sync.hpp"
#include "vulkan_game/engine/texture.hpp"
#include "vulkan_game/engine/types.hpp"
#include "vulkan_game/engine/vk_context.hpp"

#include <array>

struct GLFWwindow;

namespace vulkan_game {

class Renderer {
public:
    void init(GLFWwindow* window);
    void draw_frame();           // legacy shim: renders a single static quad
    void draw_scene(Scene& scene);
    void shutdown();

    Camera& camera() { return camera_; }

private:
    void create_sprite_pipeline();
    void create_uniform_buffers();
    void update_uniform_buffer(uint32_t frame_index, const glm::mat4& vp);

    VkContext context_;
    Swapchain swapchain_;
    RenderPassManager render_pass_mgr_;
    CommandPool command_pool_;
    SyncObjects sync_;
    DescriptorManager descriptors_;

    VkPipelineLayout sprite_pipeline_layout_ = VK_NULL_HANDLE;
    VkPipeline sprite_pipeline_ = VK_NULL_HANDLE;

    SpriteBatch sprite_batch_;
    std::array<Buffer, kMaxFramesInFlight> uniform_buffers_;
    Texture test_texture_;
    Texture tileset_texture_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> descriptor_sets_{};
    std::array<VkDescriptorSet, kMaxFramesInFlight> tilemap_descriptor_sets_{};
    Camera camera_;

    uint32_t current_frame_ = 0;
    uint32_t acquire_semaphore_index_ = 0;
    float last_time_ = 0.0f;
};

}  // namespace vulkan_game
