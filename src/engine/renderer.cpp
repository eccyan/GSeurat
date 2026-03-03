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
                                context_.graphics_queue(), "assets/textures/player_sheet.png");

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
    create_ui_pipeline();

    float aspect = static_cast<float>(kWindowWidth) / static_cast<float>(kWindowHeight);
    camera_.configure_hd2d(aspect);

    last_time_ = static_cast<float>(glfwGetTime());
}

void Renderer::init_font(const FontAtlas& atlas) {
    font_texture_ =
        Texture::load_from_memory(context_.device(), context_.allocator(), command_pool_.pool(),
                                  context_.graphics_queue(), atlas.pixels(),
                                  atlas.width(), atlas.height(), VK_FILTER_LINEAR);

    // Font descriptor sets with game UBOs (for world-space overlay)
    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    font_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        font_texture_.image_view(), font_texture_.sampler());

    // UI uniform buffers with orthographic projection
    for (auto& buf : ui_uniform_buffers_) {
        buf = Buffer::create_uniform(context_.allocator(), sizeof(UniformBufferObject));
    }
    auto ortho_vp = glm::ortho(0.0f, static_cast<float>(kWindowWidth),
                                static_cast<float>(kWindowHeight), 0.0f, -1.0f, 1.0f);
    for (auto& buf : ui_uniform_buffers_) {
        UniformBufferObject ubo{};
        ubo.vp = ortho_vp;
        ubo.ambient_color = glm::vec4(1.0f, 1.0f, 1.0f, 1.0f);  // no dimming for UI
        ubo.light_params = glm::ivec4(0, 0, 0, 0);               // no lights for UI
        std::memcpy(buf.mapped(), &ubo, sizeof(ubo));
    }

    // UI descriptor sets with UI UBOs (for screen-space dialog)
    std::array<VkBuffer, kMaxFramesInFlight> ui_ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ui_ubo_buffers[i] = ui_uniform_buffers_[i].buffer();
    }
    ui_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ui_ubo_buffers, sizeof(UniformBufferObject),
        font_texture_.image_view(), font_texture_.sampler());

    font_initialized_ = true;
}

void Renderer::init_particles() {
    particle_texture_ =
        Texture::load_from_file(context_.device(), context_.allocator(), command_pool_.pool(),
                                context_.graphics_queue(), "assets/textures/particle_atlas.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    particle_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        particle_texture_.image_view(), particle_texture_.sampler());
}

void Renderer::draw_scene(Scene& scene,
                           const std::vector<SpriteDrawInfo>& entity_sprites,
                           const std::vector<SpriteDrawInfo>& particles,
                           const std::vector<SpriteDrawInfo>& overlay,
                           const std::vector<SpriteDrawInfo>& ui) {
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

    // Reset vertex write offset for this frame
    sprite_batch_.begin_frame();

    // Build UBO with camera VP and lighting data from scene
    UniformBufferObject ubo{};
    ubo.vp = camera_.view_projection();
    ubo.ambient_color = scene.ambient_color();
    auto& scene_lights = scene.lights();
    int light_count = static_cast<int>(std::min(scene_lights.size(),
                                                static_cast<size_t>(kMaxLights)));
    ubo.light_params = glm::ivec4(light_count, 0, 0, 0);
    for (int i = 0; i < light_count; i++) {
        ubo.lights[i] = scene_lights[i];
    }
    update_uniform_buffer(current_frame_, ubo);

    // Bind vertex/index buffers once (shared across all passes)
    sprite_batch_.bind(cmd, current_frame_);

    // Tilemap pass
    if (scene.tile_layer().has_value()) {
        sprite_batch_.begin();
        for (const auto& draw_info : scene.tile_layer()->generate_draw_infos()) {
            sprite_batch_.draw(draw_info);
        }
        auto tile_flush = sprite_batch_.flush(current_frame_);
        if (tile_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &tilemap_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, tile_flush.index_count, 1, 0, tile_flush.vertex_offset, 0);
        }
    }

    // Entity pass
    sprite_batch_.begin();
    for (const auto& info : entity_sprites) {
        sprite_batch_.draw(info);
    }
    auto entity_flush = sprite_batch_.flush(current_frame_);
    if (entity_flush.index_count > 0) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_, 0,
                                1, &descriptor_sets_[current_frame_], 0, nullptr);
        vkCmdDrawIndexed(cmd, entity_flush.index_count, 1, 0, entity_flush.vertex_offset, 0);
    }

    // Particle pass (world-space, particle texture, depth ON, lit by point lights)
    if (!particles.empty()) {
        sprite_batch_.begin();
        for (const auto& spr : particles) {
            sprite_batch_.draw(spr);
        }
        auto particle_flush = sprite_batch_.flush(current_frame_);
        if (particle_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &particle_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, particle_flush.index_count, 1, 0, particle_flush.vertex_offset, 0);
        }
    }

    // Overlay pass (world-space, font texture, depth ON)
    if (font_initialized_ && !overlay.empty()) {
        sprite_batch_.begin();
        for (const auto& spr : overlay) {
            sprite_batch_.draw(spr);
        }
        auto overlay_flush = sprite_batch_.flush(current_frame_);
        if (overlay_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &font_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, overlay_flush.index_count, 1, 0, overlay_flush.vertex_offset, 0);
        }
    }

    // UI pass (screen-space, font texture, depth OFF)
    if (font_initialized_ && !ui.empty()) {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, ui_pipeline_);
        sprite_batch_.begin();
        for (const auto& spr : ui) {
            sprite_batch_.draw(spr);
        }
        auto ui_flush = sprite_batch_.flush(current_frame_);
        if (ui_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &ui_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, ui_flush.index_count, 1, 0, ui_flush.vertex_offset, 0);
        }
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
    // Legacy shim: render a single white quad
    Scene test_scene;
    SpriteDrawInfo info{};
    info.position = {0.0f, 0.0f, 0.0f};
    info.size = {1.0f, 1.0f};
    info.color = {1.0f, 1.0f, 1.0f, 1.0f};
    draw_scene(test_scene, {info}, {}, {}, {});
}

void Renderer::shutdown() {
    vkDeviceWaitIdle(context_.device());

    test_texture_.destroy(context_.device(), context_.allocator());
    tileset_texture_.destroy(context_.device(), context_.allocator());
    particle_texture_.destroy(context_.device(), context_.allocator());
    if (font_initialized_) {
        font_texture_.destroy(context_.device(), context_.allocator());
        for (auto& buf : ui_uniform_buffers_) {
            buf.destroy(context_.allocator());
        }
    }

    for (auto& buf : uniform_buffers_) {
        buf.destroy(context_.allocator());
    }
    sprite_batch_.shutdown(context_.allocator());

    vkDestroyPipeline(context_.device(), sprite_pipeline_, nullptr);
    if (ui_pipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(context_.device(), ui_pipeline_, nullptr);
    }
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

void Renderer::create_ui_pipeline() {
    auto device = context_.device();

    auto vert = load_shader_module(device, "shaders/sprite.vert.spv");
    auto frag = load_shader_module(device, "shaders/sprite.frag.spv");

    auto binding = Vertex::binding_description();
    auto attributes = Vertex::attribute_descriptions();

    ui_pipeline_ = PipelineBuilder()
                       .set_shaders(vert, frag)
                       .set_vertex_input(binding, attributes.data(),
                                         static_cast<uint32_t>(attributes.size()))
                       .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
                       .set_viewport_scissor(swapchain_.extent())
                       .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE)
                       .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
                       .set_depth_stencil(false, false)
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

void Renderer::update_uniform_buffer(uint32_t frame_index, const UniformBufferObject& ubo) {
    std::memcpy(uniform_buffers_[frame_index].mapped(), &ubo, sizeof(ubo));
}

}  // namespace vulkan_game
