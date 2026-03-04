#include "vulkan_game/engine/renderer.hpp"
#include "vulkan_game/engine/pipeline.hpp"
#include "vulkan_game/engine/resource_manager.hpp"

#include <array>
#include <cstring>
#include <stdexcept>
#include <vector>

#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <stb_image_write.h>

namespace vulkan_game {

void Renderer::init(GLFWwindow* window, ResourceManager& resources) {
    context_.init(window);
    swapchain_.init(context_, kWindowWidth, kWindowHeight);
    render_pass_mgr_.init(context_.device(), context_.allocator(), swapchain_);
    post_process_.init(context_.device(), context_.allocator(), swapchain_);
    command_pool_.init(context_.device(), context_.graphics_queue_family());
    sync_.init(context_.device(), swapchain_.image_count());
    descriptors_.init(context_.device());

    sprite_batch_.init(context_.allocator(), context_.device(), command_pool_.pool(),
                       context_.graphics_queue());

    create_uniform_buffers();

    resources.init(context_.device(), context_.allocator(), command_pool_.pool(),
                   context_.graphics_queue());

    test_texture_ = resources.load_texture("assets/textures/player_sheet.png");
    tileset_texture_ = resources.load_texture("assets/textures/tileset.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject), test_texture_->image_view(),
        test_texture_->sampler());

    tilemap_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        tileset_texture_->image_view(), tileset_texture_->sampler());

    create_sprite_pipeline();
    create_ui_pipeline();

    float aspect = static_cast<float>(kWindowWidth) / static_cast<float>(kWindowHeight);
    camera_.configure_hd2d(aspect);

    last_time_ = static_cast<float>(glfwGetTime());
}

void Renderer::init_font(const FontAtlas& atlas, ResourceManager& resources) {
    font_texture_ = resources.load_texture_from_memory(
        "font_atlas", atlas.pixels(), atlas.width(), atlas.height(), VK_FILTER_LINEAR);

    // Font descriptor sets with game UBOs (for world-space overlay)
    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    font_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        font_texture_->image_view(), font_texture_->sampler());

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
        font_texture_->image_view(), font_texture_->sampler());

    font_initialized_ = true;
}

void Renderer::init_particles(ResourceManager& resources) {
    particle_texture_ = resources.load_texture("assets/textures/particle_atlas.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    particle_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        particle_texture_->image_view(), particle_texture_->sampler());
}

void Renderer::init_shadows(ResourceManager& resources) {
    shadow_texture_ = resources.load_texture("assets/textures/shadow_blob.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    shadow_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        shadow_texture_->image_view(), shadow_texture_->sampler());
}

void Renderer::init_backgrounds(const std::vector<ResourceHandle<Texture>>& bg_textures) {
    bg_textures_ = bg_textures;

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }

    bg_descriptor_sets_.reserve(bg_textures_.size());
    for (const auto& tex : bg_textures_) {
        auto sets = descriptors_.allocate_sprite_sets(
            context_.device(), ubo_buffers, sizeof(UniformBufferObject),
            tex->image_view(), tex->sampler());
        bg_descriptor_sets_.push_back(sets);
    }
}

void Renderer::draw_scene(Scene& scene,
                           const std::vector<SpriteDrawInfo>& entity_sprites,
                           const std::vector<SpriteDrawInfo>& reflection_sprites,
                           const std::vector<SpriteDrawInfo>& shadow_sprites,
                           const std::vector<SpriteDrawInfo>& particles,
                           const std::vector<SpriteDrawInfo>& overlay,
                           const std::vector<ui::UIDrawBatch>& ui_batches,
                           const FeatureFlags& flags) {
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

    // ===== Pass 1: Scene render pass (offscreen HDR) =====
    {
        std::array<VkClearValue, 2> clear_values{};
        clear_values[0].color = {{0.05f, 0.05f, 0.15f, 1.0f}};
        clear_values[1].depthStencil = {1.0f, 0};

        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = post_process_.scene_render_pass();
        rp_info.framebuffer = post_process_.scene_framebuffer();
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

        // Apply feature flags to UBO
        if (!flags.point_lights) {
            ubo.light_params = glm::ivec4(0, 0, 0, 0);
        }
        update_uniform_buffer(current_frame_, ubo);

        // Bind vertex/index buffers once (shared across all passes)
        sprite_batch_.bind(cmd, current_frame_);

        // Background layers pass (rendered before tilemap, back-to-front by Z)
        // Override Z to a negative value so backgrounds sit behind everything
        // in camera space. The HD-2D camera at z≈9.83 would otherwise make
        // scene-JSON Z values (5-10) appear closer than entities at z=0.
        if (flags.parallax_backgrounds && !scene.background_layers().empty()) {
            auto cam_target = camera_.target();
            glm::vec2 cam_xy = {cam_target.x, cam_target.y};

            for (size_t i = 0; i < scene.background_layers().size(); ++i) {
                if (i >= bg_descriptor_sets_.size()) break;

                sprite_batch_.begin();
                auto draw_info = scene.background_layers()[i].generate_draw_info(cam_xy);
                draw_info.position.z = -20.0f;  // behind everything in camera space
                sprite_batch_.draw(draw_info);
                auto bg_flush = sprite_batch_.flush(current_frame_);
                if (bg_flush.index_count > 0) {
                    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                            sprite_pipeline_layout_, 0, 1,
                                            &bg_descriptor_sets_[i][current_frame_], 0, nullptr);
                    vkCmdDrawIndexed(cmd, bg_flush.index_count, 1, 0, bg_flush.vertex_offset, 0);
                }
            }
        }

        // Tilemap pass
        if (scene.tile_layer().has_value()) {
            sprite_batch_.begin();
            for (const auto& draw_info : scene.tile_layer()->generate_draw_infos(scene.tile_animator())) {
                sprite_batch_.draw(draw_info);
            }
            auto tile_flush = sprite_batch_.flush(current_frame_);
            if (tile_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &tilemap_descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, tile_flush.index_count, 1, 0, tile_flush.vertex_offset, 0);
            }
        }

        // Reflection pass (between tilemap and shadows)
        if (flags.water_reflections && !reflection_sprites.empty()) {
            sprite_batch_.begin();
            for (const auto& spr : reflection_sprites) {
                sprite_batch_.draw(spr);
            }
            auto refl_flush = sprite_batch_.flush(current_frame_);
            if (refl_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, refl_flush.index_count, 1, 0,
                                 refl_flush.vertex_offset, 0);
            }
        }

        // Shadow pass (between tilemap and entities)
        if (flags.blob_shadows && !shadow_sprites.empty()) {
            sprite_batch_.begin();
            for (const auto& spr : shadow_sprites) {
                sprite_batch_.draw(spr);
            }
            auto shadow_flush = sprite_batch_.flush(current_frame_);
            if (shadow_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &shadow_descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, shadow_flush.index_count, 1, 0,
                                 shadow_flush.vertex_offset, 0);
            }
        }

        // Entity pass
        sprite_batch_.begin();
        for (const auto& info : entity_sprites) {
            sprite_batch_.draw(info);
        }
        auto entity_flush = sprite_batch_.flush(current_frame_);
        if (entity_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_layout_,
                                    0, 1, &descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, entity_flush.index_count, 1, 0, entity_flush.vertex_offset, 0);
        }

        // Particle pass
        if (flags.particles && !particles.empty()) {
            sprite_batch_.begin();
            for (const auto& spr : particles) {
                sprite_batch_.draw(spr);
            }
            auto particle_flush = sprite_batch_.flush(current_frame_);
            if (particle_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &particle_descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, particle_flush.index_count, 1, 0,
                                 particle_flush.vertex_offset, 0);
            }
        }

        // Overlay pass (world-space, font texture)
        if (font_initialized_ && !overlay.empty()) {
            sprite_batch_.begin();
            for (const auto& spr : overlay) {
                sprite_batch_.draw(spr);
            }
            auto overlay_flush = sprite_batch_.flush(current_frame_);
            if (overlay_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &font_descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, overlay_flush.index_count, 1, 0,
                                 overlay_flush.vertex_offset, 0);
            }
        }

        vkCmdEndRenderPass(cmd);
    }

    // ===== Pass 2-4: Post-processing (bloom extract, blur H, blur V) + begin composite =====
    PostProcessParams pp_params;
    pp_params.dof_near_plane = camera_.near_plane();
    pp_params.dof_far_plane = camera_.far_plane();
    pp_params.fog_density = scene.fog_density();
    pp_params.fog_color_r = scene.fog_color().r;
    pp_params.fog_color_g = scene.fog_color().g;
    pp_params.fog_color_b = scene.fog_color().b;

    // Apply feature flags to post-process
    if (!flags.bloom) pp_params.bloom_intensity = 0.0f;
    if (!flags.depth_of_field) pp_params.dof_max_blur = 0.0f;
    if (!flags.vignette) pp_params.vignette_radius = 2.0f;
    if (!flags.tone_mapping) pp_params.exposure = 1.0f;
    if (!flags.fog) pp_params.fog_density = 0.0f;
    pp_params.fade_amount = fade_amount_;

    post_process_.record_post_process(cmd, image_index, pp_params);

    // ===== Pass 5: UI (drawn inside the composite render pass, unaffected by post-processing) =====
    if (font_initialized_ && !ui_batches.empty()) {
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, ui_pipeline_);

        // Re-bind sprite batch vertex/index buffers for UI drawing
        sprite_batch_.bind(cmd, current_frame_);

        VkRect2D full_scissor{};
        full_scissor.offset = {0, 0};
        full_scissor.extent = swapchain_.extent();

        // Scale factor from logical UI coords to framebuffer coords (Retina 2x etc.)
        float sx = static_cast<float>(swapchain_.extent().width) / static_cast<float>(kWindowWidth);
        float sy = static_cast<float>(swapchain_.extent().height) / static_cast<float>(kWindowHeight);

        for (const auto& batch : ui_batches) {
            if (batch.sprites.empty()) continue;

            // Set scissor rect (dynamic state)
            if (batch.scissor) {
                VkRect2D scissor{};
                scissor.offset.x = static_cast<int32_t>(static_cast<float>(batch.scissor->x) * sx);
                scissor.offset.y = static_cast<int32_t>(static_cast<float>(batch.scissor->y) * sy);
                scissor.extent.width = static_cast<uint32_t>(static_cast<float>(batch.scissor->width) * sx);
                scissor.extent.height = static_cast<uint32_t>(static_cast<float>(batch.scissor->height) * sy);
                vkCmdSetScissor(cmd, 0, 1, &scissor);
            } else {
                vkCmdSetScissor(cmd, 0, 1, &full_scissor);
            }

            sprite_batch_.begin();
            for (const auto& spr : batch.sprites) {
                sprite_batch_.draw(spr);
            }
            auto ui_flush = sprite_batch_.flush(current_frame_);
            if (ui_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        sprite_pipeline_layout_, 0, 1,
                                        &ui_descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, ui_flush.index_count, 1, 0, ui_flush.vertex_offset, 0);
            }
        }

        // Reset scissor to full viewport
        vkCmdSetScissor(cmd, 0, 1, &full_scissor);
    }

    // End composite render pass
    vkCmdEndRenderPass(cmd);

    // Screenshot: copy swapchain image to staging buffer
    bool screenshot_requested = !screenshot_path_.empty();
    if (screenshot_requested) {
        // Lazy-init readback buffer
        if (!screenshot_buffer_initialized_) {
            VkDeviceSize buf_size = static_cast<VkDeviceSize>(swapchain_.extent().width) *
                                    swapchain_.extent().height * 4;
            screenshot_staging_buffer_ = Buffer::create_readback(context_.allocator(), buf_size);
            screenshot_buffer_initialized_ = true;
        }

        VkImage src_image = swapchain_.image(image_index);

        // Barrier: PRESENT_SRC → TRANSFER_SRC
        VkImageMemoryBarrier to_transfer{};
        to_transfer.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        to_transfer.srcAccessMask = VK_ACCESS_MEMORY_READ_BIT;
        to_transfer.dstAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        to_transfer.oldLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        to_transfer.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        to_transfer.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        to_transfer.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        to_transfer.image = src_image;
        to_transfer.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            0, 0, nullptr, 0, nullptr, 1, &to_transfer);

        // Copy image to buffer
        VkBufferImageCopy region{};
        region.bufferOffset = 0;
        region.bufferRowLength = 0;
        region.bufferImageHeight = 0;
        region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
        region.imageOffset = {0, 0, 0};
        region.imageExtent = {swapchain_.extent().width, swapchain_.extent().height, 1};

        vkCmdCopyImageToBuffer(cmd, src_image, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL,
                               screenshot_staging_buffer_.buffer(), 1, &region);

        // Barrier: TRANSFER_SRC → PRESENT_SRC
        VkImageMemoryBarrier to_present{};
        to_present.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
        to_present.srcAccessMask = VK_ACCESS_TRANSFER_READ_BIT;
        to_present.dstAccessMask = VK_ACCESS_MEMORY_READ_BIT;
        to_present.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
        to_present.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
        to_present.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        to_present.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
        to_present.image = src_image;
        to_present.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};

        vkCmdPipelineBarrier(cmd,
            VK_PIPELINE_STAGE_TRANSFER_BIT,
            VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT,
            0, 0, nullptr, 0, nullptr, 1, &to_present);
    }

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

    // Screenshot readback: wait for GPU, read buffer, swizzle BGRA→RGBA, write PNG
    if (screenshot_requested) {
        vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);
        vmaInvalidateAllocation(context_.allocator(), screenshot_staging_buffer_.allocation(), 0, VK_WHOLE_SIZE);

        uint32_t w = swapchain_.extent().width;
        uint32_t h = swapchain_.extent().height;
        auto* src = static_cast<const uint8_t*>(screenshot_staging_buffer_.mapped());

        std::vector<uint8_t> rgba(w * h * 4);
        for (uint32_t i = 0; i < w * h; ++i) {
            rgba[i * 4 + 0] = src[i * 4 + 2]; // B → R
            rgba[i * 4 + 1] = src[i * 4 + 1]; // G → G
            rgba[i * 4 + 2] = src[i * 4 + 0]; // R → B
            rgba[i * 4 + 3] = 255;             // A = opaque
        }

        screenshot_write_ok_ = stbi_write_png(screenshot_path_.c_str(),
                                               static_cast<int>(w), static_cast<int>(h),
                                               4, rgba.data(), static_cast<int>(w * 4)) != 0;
        screenshot_width_ = w;
        screenshot_height_ = h;
        screenshot_path_.clear();
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

void Renderer::request_screenshot(const std::string& path) {
    screenshot_path_ = path;
    screenshot_write_ok_ = false;
}

void Renderer::draw_frame() {
    // Legacy shim: render a single white quad
    Scene test_scene;
    SpriteDrawInfo info{};
    info.position = {0.0f, 0.0f, 0.0f};
    info.size = {1.0f, 1.0f};
    info.color = {1.0f, 1.0f, 1.0f, 1.0f};
    draw_scene(test_scene, {info}, {}, {}, {}, {}, {});
}

void Renderer::shutdown() {
    vkDeviceWaitIdle(context_.device());

    // Release texture handles (actual GPU cleanup happens via shared_ptr destructor
    // or ResourceManager::shutdown — we must destroy here while device is valid)
    auto destroy_tex = [&](ResourceHandle<Texture>& h) {
        if (h) { h->destroy(context_.device(), context_.allocator()); h = {}; }
    };
    destroy_tex(test_texture_);
    destroy_tex(tileset_texture_);
    destroy_tex(particle_texture_);
    destroy_tex(shadow_texture_);
    for (auto& tex : bg_textures_) {
        destroy_tex(tex);
    }
    bg_textures_.clear();
    bg_descriptor_sets_.clear();
    if (font_initialized_) {
        destroy_tex(font_texture_);
        for (auto& buf : ui_uniform_buffers_) {
            buf.destroy(context_.allocator());
        }
    }

    if (screenshot_buffer_initialized_) {
        screenshot_staging_buffer_.destroy(context_.allocator());
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
    post_process_.shutdown(context_.device(), context_.allocator());
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
                           .set_render_pass(post_process_.scene_render_pass(), 0)
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
                       .set_dynamic_scissor()
                       .set_layout(sprite_pipeline_layout_)
                       .set_render_pass(post_process_.composite_render_pass(), 0)
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
