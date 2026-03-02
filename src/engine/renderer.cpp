#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/pipeline.hpp"

#include <array>
#include <cstring>
#include <stdexcept>

#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

namespace vulkan_game {

void Renderer::init(GLFWwindow* window) {
    context_.init(window);
    swapchain_.init(context_, kWindowWidth, kWindowHeight);
    render_pass_mgr_.init(context_.device(), context_.allocator(), swapchain_);
    command_pool_.init(context_.device(), context_.graphics_queue_family());
    sync_.init(context_.device(), swapchain_.image_count());
    descriptors_.init(context_.device());

    sprite_batch_.init(context_.allocator(), context_.device(), command_pool_.pool(),
                       context_.graphics_queue());

    create_uniform_buffers();

    test_texture_ =
        Texture::load_from_file(context_.device(), context_.allocator(), command_pool_.pool(),
                                context_.graphics_queue(), "assets/textures/test_sprite.png");

    tileset_texture_ =
        Texture::load_from_file(context_.device(), context_.allocator(), command_pool_.pool(),
                                context_.graphics_queue(), "assets/textures/tileset.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject), test_texture_.image_view(),
        test_texture_.sampler());

    tilemap_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        tileset_texture_.image_view(), tileset_texture_.sampler());

    create_sprite_pipeline();

    float aspect = static_cast<float>(kWindowWidth) / static_cast<float>(kWindowHeight);
    camera_.configure_hd2d(aspect);

    last_time_ = static_cast<float>(glfwGetTime());
}

void Renderer::draw_scene(Scene& scene) {
    auto device = context_.device();
    const auto& frame_sync = sync_.frame(current_frame_);

    // Delta time
    float now = static_cast<float>(glfwGetTime());
    float dt = now - last_time_;
    last_time_ = now;

    camera_.update(dt);

    vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);

    uint32_t image_index;
    auto acquire_sem = sync_.acquire_semaphore(acquire_semaphore_index_);
    vkAcquireNextImageKHR(device, swapchain_.swapchain(), UINT64_MAX, acquire_sem, VK_NULL_HANDLE,
                          &image_index);
    acquire_semaphore_index_ =
        (acquire_semaphore_index_ + 1) % sync_.acquire_semaphore_count();

    vkResetFences(device, 1, &frame_sync.in_flight);

    auto cmd = command_pool_.command_buffer(current_frame_);
    vkResetCommandBuffer(cmd, 0);

    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    vkBeginCommandBuffer(cmd, &begin_info);

    std::array<VkClearValue, 2> clear_values{};
    clear_values[0].color = {{0.05f, 0.05f, 0.15f, 1.0f}};
    clear_values[1].depthStencil = {1.0f, 0};

    VkRenderPassBeginInfo rp_info{};
    rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    rp_info.renderPass = render_pass_mgr_.render_pass();
    rp_info.framebuffer = render_pass_mgr_.framebuffer(image_index);
    rp_info.renderArea.extent = swapchain_.extent();
    rp_info.clearValueCount = static_cast<uint32_t>(clear_values.size());
    rp_info.pClearValues = clear_values.data();

    vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_);

    update_uniform_buffer(current_frame_, camera_.view_projection());

    // Tilemap pass
    if (scene.tile_layer().has_value()) {
        sprite_batch_.begin();
        for (const auto& draw_info : scene.tile_layer()->generate_draw_infos()) {
            sprite_batch_.draw(draw_info);
        }
        uint32_t tile_index_count = sprite_batch_.flush(current_frame_);
        if (tile_index_count > 0) {
            sprite_batch_.bind(cmd, current_frame_);
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &tilemap_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, tile_index_count, 1, 0, 0, 0);
        }
    }

    // Entity pass
    sprite_batch_.begin();
    for (const auto& entity_ptr : scene.entities()) {
        const auto& e = *entity_ptr;
        SpriteDrawInfo info{};
        info.position = e.transform.position;
        info.size = e.transform.scale;
        info.color = e.tint;
        sprite_batch_.draw(info);
    }
    uint32_t entity_index_count = sprite_batch_.flush(current_frame_);
    if (entity_index_count > 0) {
        sprite_batch_.bind(cmd, current_frame_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_, 0,
                                1, &descriptor_sets_[current_frame_], 0, nullptr);
        vkCmdDrawIndexed(cmd, entity_index_count, 1, 0, 0, 0);
    }

    vkCmdEndRenderPass(cmd);
    vkEndCommandBuffer(cmd);

    auto render_done_sem = sync_.render_finished_semaphore(image_index);

    VkPipelineStageFlags wait_stage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    VkSubmitInfo submit{};
    submit.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submit.waitSemaphoreCount = 1;
    submit.pWaitSemaphores = &acquire_sem;
    submit.pWaitDstStageMask = &wait_stage;
    submit.commandBufferCount = 1;
    submit.pCommandBuffers = &cmd;
    submit.signalSemaphoreCount = 1;
    submit.pSignalSemaphores = &render_done_sem;

    if (vkQueueSubmit(context_.graphics_queue(), 1, &submit, frame_sync.in_flight) != VK_SUCCESS) {
        throw std::runtime_error("Failed to submit draw command buffer");
    }

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &render_done_sem;
    present.swapchainCount = 1;
    auto sc = swapchain_.swapchain();
    present.pSwapchains = &sc;
    present.pImageIndices = &image_index;

    vkQueuePresentKHR(context_.graphics_queue(), &present);

    current_frame_ = (current_frame_ + 1) % kMaxFramesInFlight;
}

void Renderer::draw_frame() {
    // Legacy shim: create a static test scene with one white quad and render it
    Scene test_scene;
    auto* e = test_scene.create_entity();
    e->transform.position = {0.0f, 0.0f, 0.0f};
    e->transform.scale = {1.0f, 1.0f};
    e->tint = {1.0f, 1.0f, 1.0f, 1.0f};
    draw_scene(test_scene);
}

void Renderer::shutdown() {
    vkDeviceWaitIdle(context_.device());

    test_texture_.destroy(context_.device(), context_.allocator());
    tileset_texture_.destroy(context_.device(), context_.allocator());

    for (auto& buf : uniform_buffers_) {
        buf.destroy(context_.allocator());
    }
    sprite_batch_.shutdown(context_.allocator());

    vkDestroyPipeline(context_.device(), sprite_pipeline_, nullptr);
    vkDestroyPipelineLayout(context_.device(), sprite_pipeline_layout_, nullptr);

    descriptors_.shutdown(context_.device());
    sync_.shutdown(context_.device());
    command_pool_.shutdown(context_.device());
    render_pass_mgr_.shutdown(context_.device(), context_.allocator());
    swapchain_.shutdown(context_.device());
    context_.shutdown();
}

void Renderer::create_sprite_pipeline() {
    auto device = context_.device();

    auto vert = load_shader_module(device, "shaders/sprite.vert.spv");
    auto frag = load_shader_module(device, "shaders/sprite.frag.spv");

    VkPipelineLayoutCreateInfo layout_info{};
    layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    auto desc_layout = descriptors_.sprite_layout();
    layout_info.setLayoutCount = 1;
    layout_info.pSetLayouts = &desc_layout;

    if (vkCreatePipelineLayout(device, &layout_info, nullptr, &sprite_pipeline_layout_) !=
        VK_SUCCESS) {
        throw std::runtime_error("Failed to create pipeline layout");
    }

    auto binding = Vertex::binding_description();
    auto attributes = Vertex::attribute_descriptions();

    sprite_pipeline_ = PipelineBuilder()
                           .set_shaders(vert, frag)
                           .set_vertex_input(binding, attributes.data(),
                                             static_cast<uint32_t>(attributes.size()))
                           .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
                           .set_viewport_scissor(swapchain_.extent())
                           .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_BACK_BIT)
                           .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
                           .set_depth_stencil(true, true)
                           .set_color_blend_alpha()
                           .set_layout(sprite_pipeline_layout_)
                           .set_render_pass(render_pass_mgr_.render_pass(), 0)
                           .build(device);

    vkDestroyShaderModule(device, frag, nullptr);
    vkDestroyShaderModule(device, vert, nullptr);
}

void Renderer::create_uniform_buffers() {
    for (auto& buf : uniform_buffers_) {
        buf = Buffer::create_uniform(context_.allocator(), sizeof(UniformBufferObject));
    }
}

void Renderer::update_uniform_buffer(uint32_t frame_index, const glm::mat4& vp) {
    UniformBufferObject ubo{};
    ubo.vp = vp;
    std::memcpy(uniform_buffers_[frame_index].mapped(), &ubo, sizeof(ubo));
}

}  // namespace vulkan_game
