#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/pipeline.hpp"

#include <array>
#include <cstring>
#include <stdexcept>

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

    create_quad_buffers();
    create_uniform_buffers();

    test_texture_ =
        Texture::load_from_file(context_.device(), context_.allocator(), command_pool_.pool(),
                                context_.graphics_queue(), "assets/textures/test_sprite.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject), test_texture_.image_view(),
        test_texture_.sampler());

    create_sprite_pipeline();

    camera_.set_perspective(45.0f, static_cast<float>(kWindowWidth) / kWindowHeight, 0.1f, 100.0f);
}

void Renderer::draw_frame() {
    auto device = context_.device();
    const auto& frame_sync = sync_.frame(current_frame_);

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

    VkBuffer vertex_buffers[] = {quad_vertex_buffer_.buffer()};
    VkDeviceSize offsets[] = {0};
    vkCmdBindVertexBuffers(cmd, 0, 1, vertex_buffers, offsets);
    vkCmdBindIndexBuffer(cmd, quad_index_buffer_.buffer(), 0, VK_INDEX_TYPE_UINT16);

    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_, 0, 1,
                            &descriptor_sets_[current_frame_], 0, nullptr);

    update_uniform_buffer(current_frame_);

    vkCmdDrawIndexed(cmd, 6, 1, 0, 0, 0);

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

void Renderer::shutdown() {
    vkDeviceWaitIdle(context_.device());

    test_texture_.destroy(context_.device(), context_.allocator());

    for (auto& buf : uniform_buffers_) {
        buf.destroy(context_.allocator());
    }
    quad_index_buffer_.destroy(context_.allocator());
    quad_vertex_buffer_.destroy(context_.allocator());

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

void Renderer::create_quad_buffers() {
    auto device = context_.device();
    auto allocator = context_.allocator();
    auto queue = context_.graphics_queue();

    // Quad vertices
    Vertex vertices[] = {
        {{-0.5f, -0.5f, 0.0f}, {0.0f, 0.0f}},
        {{ 0.5f, -0.5f, 0.0f}, {1.0f, 0.0f}},
        {{ 0.5f,  0.5f, 0.0f}, {1.0f, 1.0f}},
        {{-0.5f,  0.5f, 0.0f}, {0.0f, 1.0f}},
    };
    uint16_t indices[] = {0, 1, 2, 2, 3, 0};

    VkDeviceSize vertex_size = sizeof(vertices);
    VkDeviceSize index_size = sizeof(indices);

    // Upload vertices via staging
    auto staging_v = Buffer::create_staging(allocator, vertex_size);
    staging_v.upload(vertices, vertex_size);
    quad_vertex_buffer_ = Buffer::create_vertex(allocator, vertex_size);

    auto cmd = command_pool_.begin_single_time(device);
    VkBufferCopy copy_v{};
    copy_v.size = vertex_size;
    vkCmdCopyBuffer(cmd, staging_v.buffer(), quad_vertex_buffer_.buffer(), 1, &copy_v);
    command_pool_.end_single_time(device, queue, cmd);
    staging_v.destroy(allocator);

    // Upload indices via staging
    auto staging_i = Buffer::create_staging(allocator, index_size);
    staging_i.upload(indices, index_size);
    quad_index_buffer_ = Buffer::create_index(allocator, index_size);

    cmd = command_pool_.begin_single_time(device);
    VkBufferCopy copy_i{};
    copy_i.size = index_size;
    vkCmdCopyBuffer(cmd, staging_i.buffer(), quad_index_buffer_.buffer(), 1, &copy_i);
    command_pool_.end_single_time(device, queue, cmd);
    staging_i.destroy(allocator);
}

void Renderer::create_uniform_buffers() {
    for (auto& buf : uniform_buffers_) {
        buf = Buffer::create_uniform(context_.allocator(), sizeof(UniformBufferObject));
    }
}

void Renderer::update_uniform_buffer(uint32_t frame_index) {
    auto model = glm::mat4(1.0f);
    auto vp = camera_.view_projection();
    UniformBufferObject ubo{};
    ubo.mvp = vp * model;

    std::memcpy(uniform_buffers_[frame_index].mapped(), &ubo, sizeof(ubo));
}

}  // namespace vulkan_game
