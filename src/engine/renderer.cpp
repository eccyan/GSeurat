#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/resource_manager.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <stdexcept>
#include <vector>

#include <GLFW/glfw3.h>
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
namespace gseurat {

static GsAnimEffect parse_effect_name(const std::string& name) {
    if (name == "float")    return GsAnimEffect::Float;
    if (name == "orbit")    return GsAnimEffect::Orbit;
    if (name == "dissolve") return GsAnimEffect::Dissolve;
    if (name == "reform")   return GsAnimEffect::Reform;
    if (name == "pulse")    return GsAnimEffect::Pulse;
    if (name == "vortex")   return GsAnimEffect::Vortex;
    if (name == "wave")     return GsAnimEffect::Wave;
    if (name == "scatter")  return GsAnimEffect::Scatter;
    return GsAnimEffect::Detach;
}

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

    // Load normal map textures (UNORM format — linear data, not sRGB)
    flat_normal_texture_ = resources.load_texture("assets/textures/flat_normal.png",
        VK_FILTER_NEAREST, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FORMAT_R8G8B8A8_UNORM);
    tileset_normal_texture_ = resources.load_texture("assets/textures/tileset_normal.png",
        VK_FILTER_NEAREST, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FORMAT_R8G8B8A8_UNORM);
    entity_normal_texture_ = resources.load_texture("assets/textures/player_normal.png",
        VK_FILTER_NEAREST, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FORMAT_R8G8B8A8_UNORM);

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject), test_texture_->image_view(),
        test_texture_->sampler(),
        entity_normal_texture_->image_view(), entity_normal_texture_->sampler());

    tilemap_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        tileset_texture_->image_view(), tileset_texture_->sampler(),
        tileset_normal_texture_->image_view(), tileset_normal_texture_->sampler());

    create_sprite_pipeline();
    create_outline_pipeline();
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
        font_texture_->image_view(), font_texture_->sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());

    // Create 1x1 white pixel texture for light glow rendering
    {
        uint8_t white_pixel[4] = {255, 255, 255, 255};
        white_pixel_tex_ = Texture::load_from_memory(
            context_.device(), context_.allocator(),
            command_pool_.pool(), context_.graphics_queue(),
            white_pixel, 1, 1);

        std::array<VkBuffer, kMaxFramesInFlight> ui_ubo_temp;
        for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
            ui_ubo_temp[i] = uniform_buffers_[i].buffer();
        }
        white_pixel_descriptor_sets_ = descriptors_.allocate_sprite_sets(
            context_.device(), ui_ubo_temp, sizeof(UniformBufferObject),
            white_pixel_tex_.image_view(), white_pixel_tex_.sampler(),
            flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
        white_pixel_initialized_ = true;
    }

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
        font_texture_->image_view(), font_texture_->sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());

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
        particle_texture_->image_view(), particle_texture_->sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
}

void Renderer::init_shadows(ResourceManager& resources) {
    shadow_texture_ = resources.load_texture("assets/textures/shadow_blob.png");

    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    shadow_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        shadow_texture_->image_view(), shadow_texture_->sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
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
            tex->image_view(), tex->sampler(),
            flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
        bg_descriptor_sets_.push_back(sets);
    }
}

void Renderer::init_gs(const GaussianCloud& cloud, uint32_t width, uint32_t height) {
    if (!gs_initialized_) {
        gs_renderer_.init(context_.device(), context_.allocator(), VK_NULL_HANDLE);
        gs_initialized_ = true;
    }
    gs_renderer_.resize_output(width, height);
    gs_renderer_.load_cloud(cloud);
    output_width_ = width;
    output_height_ = height;

    // Build spatial chunk grid for frustum-based streaming
    gs_chunk_grid_.build(cloud, 32.0f);
    gs_prev_visible_.clear();

    // Auto-enable adaptive LOD budget for large clouds
    gs_total_gaussian_count_ = cloud.count();
    if (gs_total_gaussian_count_ > 200000 && gs_gaussian_budget_ == 0) {
        gs_gaussian_budget_ = gs_total_gaussian_count_;  // start at full, let adaptive tuning reduce
        gs_adaptive_budget_ = true;
        gs_smoothed_fps_ = 60.0f;
    }

    // Free old GS descriptor sets before reallocating (prevents pool exhaustion on reload)
    descriptors_.free_sprite_sets(context_.device(), gs_descriptor_sets_);
    descriptors_.free_sprite_sets(context_.device(), gs_ui_descriptor_sets_);

    // Create descriptor sets for sampling the GS output as a sprite texture
    std::array<VkBuffer, kMaxFramesInFlight> ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ubo_buffers[i] = uniform_buffers_[i].buffer();
    }
    gs_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        gs_renderer_.output_view(), gs_renderer_.output_sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());

    // Also create UI-space descriptor sets (orthographic projection for fullscreen blit)
    if (font_initialized_) {
        std::array<VkBuffer, kMaxFramesInFlight> ui_ubo_buffers;
        for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
            ui_ubo_buffers[i] = ui_uniform_buffers_[i].buffer();
        }
        gs_ui_descriptor_sets_ = descriptors_.allocate_sprite_sets(
            context_.device(), ui_ubo_buffers, sizeof(UniformBufferObject),
            gs_renderer_.output_view(), gs_renderer_.output_sampler(),
            flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
    }
}

void Renderer::set_gs_background(const ResourceHandle<Texture>& texture) {
    if (!font_initialized_) return;  // need UI UBOs

    gs_bg_texture_ = texture;  // keep alive for proper cleanup

    std::array<VkBuffer, kMaxFramesInFlight> ui_ubo_buffers;
    for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
        ui_ubo_buffers[i] = ui_uniform_buffers_[i].buffer();
    }
    gs_bg_descriptor_sets_ = descriptors_.allocate_sprite_sets(
        context_.device(), ui_ubo_buffers, sizeof(UniformBufferObject),
        texture->image_view(), texture->sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
    gs_bg_initialized_ = true;
}

void Renderer::draw_scene(Scene& scene,
                           const std::vector<SpriteDrawInfo>& entity_sprites,
                           const std::vector<SpriteDrawInfo>& outline_sprites,
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

    // Suppress camera shake if disabled (zero amplitude prevents shake math)
    if (!flags.camera_shake && camera_.shake_active()) {
        camera_.trigger_shake(0.0f, 0.0f, 0.0f);
    }
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

    // Forward post-process params to GS pipeline before GS compute runs
    {
        GsPostProcessParams gs_pp{};
        gs_pp.fog_density = pp_params_.fog_density;
        gs_pp.fog_color_r = pp_params_.fog_color_r;
        gs_pp.fog_color_g = pp_params_.fog_color_g;
        gs_pp.fog_color_b = pp_params_.fog_color_b;
        if (!pp_params_.fog_override) {
            gs_pp.fog_density = scene.fog_density();
            gs_pp.fog_color_r = scene.fog_color().r;
            gs_pp.fog_color_g = scene.fog_color().g;
            gs_pp.fog_color_b = scene.fog_color().b;
        }
        gs_pp.exposure = pp_params_.exposure;
        gs_pp.vignette_radius = pp_params_.vignette_radius;
        gs_pp.vignette_softness = pp_params_.vignette_softness;
        gs_pp.bloom_intensity = pp_params_.bloom_intensity;
        gs_pp.bloom_threshold = pp_params_.bloom_threshold;
        gs_pp.fade_amount = fade_amount_;
        gs_pp.flash_r = pp_params_.flash_r;
        gs_pp.flash_g = pp_params_.flash_g;
        gs_pp.flash_b = pp_params_.flash_b;
        gs_pp.ca_intensity = pp_params_.ca_intensity;
        gs_pp.dof_focus_distance = pp_params_.dof_focus_distance;
        gs_pp.dof_focus_range = pp_params_.dof_focus_range;
        gs_pp.dof_max_blur = pp_params_.dof_max_blur;
        // Extract GS camera far plane from projection matrix for fog depth normalization
        // For perspective: proj[2][2] = -(f+n)/(f-n), proj[3][2] = -2fn/(f-n)
        // Vulkan Y-flip: proj[1][1] is negated, but [2][2] and [3][2] are unaffected.
        // far = proj[3][2] / (proj[2][2] + 1)  (derived from perspective formula)
        float p22 = gs_proj_[2][2];
        float p32 = gs_proj_[3][2];
        float denom = p22 + 1.0f;
        gs_pp.far_plane = (std::abs(denom) > 0.001f) ? (p32 / denom) : 1000.0f;
        if (!flags.bloom) gs_pp.bloom_intensity = 0.0f;
        if (!flags.depth_of_field) gs_pp.dof_max_blur = 0.0f;
        if (!flags.vignette) gs_pp.vignette_radius = 2.0f;
        if (!flags.tone_mapping) gs_pp.exposure = 1.0f;
        if (!flags.fog) gs_pp.fog_density = 0.0f;
        if (!flags.screen_effects) {
            gs_pp.ca_intensity = 0.0f;
            gs_pp.flash_r = gs_pp.flash_g = gs_pp.flash_b = 0.0f;
        }
        gs_renderer_.set_post_process_params(gs_pp);
    }

    record_gs_prepass(cmd, device, dt, flags);

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
        int normal_map_flag = flags.normal_mapping ? 1 : 0;
        ubo.light_params = glm::ivec4(light_count, normal_map_flag, 0, 0);
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
        // in camera space. The default camera at z≈9.83 would otherwise make
        // scene-JSON Z values (5-10) appear closer than entities at z=0.
        if (flags.parallax_backgrounds && !scene.background_layers().empty()) {
            auto cam_target = camera_.target();
            glm::vec2 cam_xy = {cam_target.x, cam_target.y};

            for (size_t i = 0; i < scene.background_layers().size(); ++i) {
                if (i >= bg_descriptor_sets_.size()) break;

                const auto& bg_layer = scene.background_layers()[i];
                sprite_batch_.begin();
                SpriteDrawInfo draw_info;
                if (bg_layer.wall) {
                    draw_info = bg_layer.generate_wall_draw_info(cam_xy);
                } else {
                    draw_info = bg_layer.generate_draw_info(cam_xy);
                    draw_info.position.z = -20.0f;  // behind everything in camera space
                }
                sprite_batch_.draw(draw_info);
                auto bg_flush = sprite_batch_.flush(current_frame_, bg_layer.wall);
                if (bg_flush.index_count > 0) {
                    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                            sprite_pipeline_layout_, 0, 1,
                                            &bg_descriptor_sets_[i][current_frame_], 0, nullptr);
                    vkCmdDrawIndexed(cmd, bg_flush.index_count, 1, 0, bg_flush.vertex_offset, 0);
                }
            }
        }

        // Tilemap pass
        if (flags.tilemap_rendering && scene.tile_layer().has_value()) {
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
        if (flags.water_reflections) {
            draw_sprite_pass(cmd, reflection_sprites, descriptor_sets_[current_frame_]);
        }

        // Shadow pass (between tilemap and entities)
        if (flags.blob_shadows) {
            draw_sprite_pass(cmd, shadow_sprites, shadow_descriptor_sets_[current_frame_]);
        }

        // Outline pass (between shadows and entities)
        if (flags.sprite_outlines && !outline_sprites.empty()) {
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, outline_pipeline_);

            struct OutlinePushConstants {
                float color[4];
                float thickness;
                float _pad[3];
            } outline_pc = {
                {0.05f, 0.02f, 0.02f, 1.0f},  // dark near-black
                1.2f,
                {0.0f, 0.0f, 0.0f}
            };
            vkCmdPushConstants(cmd, outline_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                               0, sizeof(OutlinePushConstants), &outline_pc);

            sprite_batch_.begin();
            for (const auto& spr : outline_sprites) {
                sprite_batch_.draw(spr);
            }
            auto outline_flush = sprite_batch_.flush(current_frame_);
            if (outline_flush.index_count > 0) {
                vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                        outline_pipeline_layout_, 0, 1,
                                        &descriptor_sets_[current_frame_], 0, nullptr);
                vkCmdDrawIndexed(cmd, outline_flush.index_count, 1, 0,
                                 outline_flush.vertex_offset, 0);
            }

            // Re-bind sprite pipeline for subsequent passes
            vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_);
        }

        // Entity pass
        draw_sprite_pass(cmd, entity_sprites, descriptor_sets_[current_frame_]);

        // Particle pass
        if (flags.particles) {
            draw_sprite_pass(cmd, particles, particle_descriptor_sets_[current_frame_]);
        }

        // Overlay pass (world-space, font texture)
        if (font_initialized_) {
            draw_sprite_pass(cmd, overlay, font_descriptor_sets_[current_frame_]);
        }

        vkCmdEndRenderPass(cmd);
    }

    // ===== Pass 2-4: Post-processing (bloom extract, blur H, blur V) + begin composite =====
    // Start from persistent params (modified by Staging panels), then apply per-frame overrides
    PostProcessParams pp_params = pp_params_;
    pp_params.dof_near_plane = camera_.near_plane();
    pp_params.dof_far_plane = camera_.far_plane();
    // Use scene fog unless panels have explicitly overridden it
    if (!pp_params.fog_override) {
        pp_params.fog_density = scene.fog_density();
        pp_params.fog_color_r = scene.fog_color().r;
        pp_params.fog_color_g = scene.fog_color().g;
        pp_params.fog_color_b = scene.fog_color().b;
    }

    // Apply feature flags to post-process
    if (!flags.bloom) pp_params.bloom_intensity = 0.0f;
    if (!flags.depth_of_field) pp_params.dof_max_blur = 0.0f;
    if (!flags.vignette) pp_params.vignette_radius = 2.0f;
    if (!flags.tone_mapping) pp_params.exposure = 1.0f;
    if (!flags.fog) pp_params.fog_density = 0.0f;
    pp_params.fade_amount = fade_amount_;
    if (flags.screen_effects) {
        pp_params.ca_intensity = ca_intensity_;
        pp_params.flash_r = flash_r_;
        pp_params.flash_g = flash_g_;
        pp_params.flash_b = flash_b_;
    }
    pp_params.god_rays_intensity = god_rays_intensity_;

    // Update light glow UBO with GS camera VP and scene lights
    {
        LightGlowData glow{};
        glow.vp = gs_proj_ * gs_view_;
        auto& scene_lights = scene.lights();
        int glow_count = static_cast<int>(std::min(scene_lights.size(),
                                                    static_cast<size_t>(kMaxLights)));
        glow.light_params = glm::ivec4(glow_count,
                                       static_cast<int>(swapchain_.extent().width),
                                       static_cast<int>(swapchain_.extent().height), 0);
        for (int i = 0; i < glow_count; i++) {
            glow.lights[i] = scene_lights[i];
        }
        post_process_.update_light_glow(context_.allocator(), glow);
    }

    post_process_.record_post_process(cmd, image_index, pp_params);

    record_gs_blit(cmd, flags);
    // Light glow is now rendered via the UI system in GsDemoState
    record_ui_pass(cmd, ui_batches);

    // End composite render pass
    vkCmdEndRenderPass(cmd);

    // Overlay callback (e.g., ImGui render pass)
    if (overlay_callback_) {
        overlay_callback_(cmd, image_index);
    }

    // Screenshot: copy swapchain image to staging buffer
    bool screenshot_requested = screenshot_.has_pending();
    if (screenshot_requested) {
        screenshot_.record_copy(cmd, swapchain_.image(image_index),
                                swapchain_.extent(), context_.allocator());
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

    // Screenshot readback: wait for GPU, swizzle BGRA→RGBA, write PNG
    if (screenshot_requested) {
        vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);
        screenshot_.readback_and_write(context_.allocator(), swapchain_.extent());
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
    draw_scene(test_scene, {info}, {}, {}, {}, {}, {}, {});
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
    destroy_tex(flat_normal_texture_);
    destroy_tex(tileset_normal_texture_);
    destroy_tex(entity_normal_texture_);
    for (auto& tex : bg_textures_) {
        destroy_tex(tex);
    }
    bg_textures_.clear();
    bg_descriptor_sets_.clear();
    if (font_initialized_) {
        destroy_tex(font_texture_);
        if (white_pixel_initialized_) {
            white_pixel_tex_.destroy(context_.device(), context_.allocator());
        }
        for (auto& buf : ui_uniform_buffers_) {
            buf.destroy(context_.allocator());
        }
    }

    if (gs_bg_texture_) {
        gs_bg_texture_->destroy(context_.device(), context_.allocator());
        gs_bg_texture_ = {};
    }
    if (gs_initialized_) {
        gs_renderer_.shutdown(context_.allocator());
    }

    screenshot_.shutdown(context_.allocator());

    for (auto& buf : uniform_buffers_) {
        buf.destroy(context_.allocator());
    }
    sprite_batch_.shutdown(context_.allocator());

    vkDestroyPipeline(context_.device(), sprite_pipeline_, nullptr);
    if (outline_pipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(context_.device(), outline_pipeline_, nullptr);
    }
    if (outline_pipeline_layout_ != VK_NULL_HANDLE) {
        vkDestroyPipelineLayout(context_.device(), outline_pipeline_layout_, nullptr);
    }
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

void Renderer::create_outline_pipeline() {
    auto device = context_.device();

    auto vert = load_shader_module(device, "shaders/sprite.vert.spv");
    auto frag = load_shader_module(device, "shaders/sprite_outline.frag.spv");

    // Pipeline layout with push constants for outline parameters
    VkPushConstantRange push_range{};
    push_range.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
    push_range.offset = 0;
    push_range.size = 32;  // outline_color(16) + thickness(4) + pad(12)

    VkPipelineLayoutCreateInfo layout_info{};
    layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    auto desc_layout = descriptors_.sprite_layout();
    layout_info.setLayoutCount = 1;
    layout_info.pSetLayouts = &desc_layout;
    layout_info.pushConstantRangeCount = 1;
    layout_info.pPushConstantRanges = &push_range;

    if (vkCreatePipelineLayout(device, &layout_info, nullptr, &outline_pipeline_layout_) !=
        VK_SUCCESS) {
        throw std::runtime_error("Failed to create outline pipeline layout");
    }

    auto binding = Vertex::binding_description();
    auto attributes = Vertex::attribute_descriptions();

    outline_pipeline_ = PipelineBuilder()
                            .set_shaders(vert, frag)
                            .set_vertex_input(binding, attributes.data(),
                                              static_cast<uint32_t>(attributes.size()))
                            .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
                            .set_viewport_scissor(swapchain_.extent())
                            .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_BACK_BIT)
                            .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
                            .set_depth_stencil(true, true)
                            .set_color_blend_alpha()
                            .set_layout(outline_pipeline_layout_)
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

void Renderer::draw_sprite_pass(VkCommandBuffer cmd,
                                const std::vector<SpriteDrawInfo>& sprites,
                                VkDescriptorSet descriptor_set) {
    if (sprites.empty()) return;
    sprite_batch_.begin();
    for (const auto& spr : sprites) {
        sprite_batch_.draw(spr);
    }
    auto result = sprite_batch_.flush(current_frame_);
    if (result.index_count > 0) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                sprite_pipeline_layout_, 0, 1,
                                &descriptor_set, 0, nullptr);
        vkCmdDrawIndexed(cmd, result.index_count, 1, 0, result.vertex_offset, 0);
    }
}

void Renderer::record_gs_prepass(VkCommandBuffer cmd, VkDevice device, float dt,
                                  const FeatureFlags& flags) {
    // Adaptive GS budget: converge to target FPS then lock
    if (flags.gs_adaptive_budget && gs_adaptive_budget_ && gs_gaussian_budget_ > 0 && dt > 0.0f) {
        float fps = 1.0f / dt;
        gs_smoothed_fps_ = gs_smoothed_fps_ * 0.9f + fps * 0.1f;

        if (!gs_budget_locked_) {
            if (gs_smoothed_fps_ < gs_target_fps_) {
                float scale = gs_smoothed_fps_ / gs_target_fps_;
                gs_gaussian_budget_ = std::max(kGsBudgetMin,
                    static_cast<uint32_t>(gs_gaussian_budget_ * scale));
                gs_prev_visible_.clear();
                gs_stable_frame_count_ = 0;
            } else {
                gs_stable_frame_count_++;
                if (gs_stable_frame_count_ >= kGsStableFramesNeeded) {
                    gs_budget_locked_ = true;
                }
            }
        }
    }

    // Gaussian splatting compute (before render pass)
    if (flags.gs_rendering && gs_initialized_ && gs_renderer_.has_cloud()) {
        if (flags.gs_chunk_culling && !gs_skip_chunk_cull_ && !gs_chunk_grid_.empty()) {
            glm::mat4 gs_vp = gs_proj_ * gs_view_;
            auto visible = gs_chunk_grid_.visible_chunks(gs_vp);

            // Force re-gather when LOD budget changes
            bool budget_changed = (gs_gaussian_budget_ != gs_prev_budget_);
            if (budget_changed) {
                gs_prev_budget_ = gs_gaussian_budget_;
            }

            // Always re-gather: camera movement changes LOD distance-based selection
            // even when the same chunks are visible (ghost artifact fix)
            {
                if ((visible != gs_prev_visible_ || budget_changed) && gs_budget_locked_) {
                    gs_budget_locked_ = false;
                    gs_stable_frame_count_ = 0;
                }
                gs_prev_visible_ = visible;

                // Re-gather scene Gaussians (only on visibility change)
                if (flags.gs_lod && gs_gaussian_budget_ > 0) {
                    glm::vec3 cam_pos = glm::vec3(glm::inverse(gs_view_)[3]);
                    gs_chunk_grid_.gather_lod(visible, cam_pos, gs_gaussian_budget_,
                                              gs_active_buffer_);
                } else {
                    gs_chunk_grid_.gather(visible, gs_active_buffer_);
                }
                gs_scene_buffer_ = gs_active_buffer_;  // cache pure-scene Gaussians
                gs_scene_base_count_ = static_cast<uint32_t>(gs_scene_buffer_.size());

                // Append VFX object Gaussians to scene buffer (static PLY geometry)
                for (auto& inst : vfx_instances_) {
                    inst.append_objects(gs_scene_buffer_);
                }

                // Scene buffer changed — animator indices are stale.
                // Reset so VFX animations re-tag on the new buffer.
                gs_animator_.reset();

                // Reset VFX animation states so they re-tag
                for (auto& inst : vfx_instances_) {
                    inst.reset_animations();
                }

                if (!gs_scene_buffer_.empty()) {
                    gs_renderer_.update_active_gaussians(
                        gs_scene_buffer_.data(),
                        static_cast<uint32_t>(gs_scene_buffer_.size()));
                }
            }

        }

        // Update particles/animations/VFX (runs regardless of chunk culling)
        bool has_particles = !gs_particle_emitters_.empty()
            || gs_animator_.has_active_groups()
            || !gs_scene_animations_.empty()
            || !vfx_instances_.empty();
        if (has_particles) {
            // Phase-based state machine for scene animations
            // Run BEFORE buffer reset so we can detect transitions to Reforming
            for (auto& sa : gs_scene_animations_) {
                using Phase = SceneAnimation::Phase;
                if (sa.phase == Phase::Effect) {
                    if (sa.group_id == 0) {
                        sa.group_id = gs_animator_.tag_region(
                            gs_scene_buffer_, sa.region,
                            parse_effect_name(sa.effect), sa.lifetime, sa.params);
                    } else if (!gs_animator_.has_group(sa.group_id)) {
                        if (sa.reform) {
                            sa.reform_group_id = gs_animator_.tag_region(
                                gs_scene_buffer_, sa.region,
                                GsAnimEffect::Reform, sa.reform->lifetime);
                            sa.phase = Phase::Reforming;
                        } else if (sa.loop) {
                            sa.group_id = gs_animator_.tag_region(
                                gs_scene_buffer_, sa.region,
                                parse_effect_name(sa.effect), sa.lifetime, sa.params);
                        } else {
                            sa.phase = Phase::Idle;
                        }
                    }
                } else if (sa.phase == Phase::Reforming) {
                    if (!gs_animator_.has_group(sa.reform_group_id)) {
                        if (sa.loop) {
                            sa.group_id = gs_animator_.tag_region(
                                gs_scene_buffer_, sa.region,
                                parse_effect_name(sa.effect), sa.lifetime, sa.params);
                            sa.phase = Phase::Effect;
                        } else {
                            sa.phase = Phase::Idle;
                        }
                    }
                }
            }

            // Check if any animation is reforming AFTER state transitions
            bool any_reforming = false;
            for (const auto& sa : gs_scene_animations_) {
                if (sa.phase == SceneAnimation::Phase::Reforming) {
                    any_reforming = true;
                    break;
                }
            }

            // Skip buffer reset during reform so displaced positions persist
            if (!any_reforming) {
                gs_active_buffer_ = gs_scene_buffer_;
            }

            // VFX object Gaussians are already in gs_scene_buffer_
            // (appended at gather time), so no per-frame append needed.

            // Animate tagged scene + object Gaussians (Mode 2)
            if (flags.animation && gs_animator_.has_active_groups()) {
                gs_animator_.update(dt, gs_active_buffer_);
            }

            // Update and append Gaussian particles from emitters
            if (flags.particles) {
                for (auto& emitter : gs_particle_emitters_) {
                    emitter.update(dt);
                    emitter.gather(gs_active_buffer_);
                }
                // Remove dead emitters
                gs_particle_emitters_.erase(
                    std::remove_if(gs_particle_emitters_.begin(), gs_particle_emitters_.end(),
                        [](const GaussianParticleEmitter& e) { return !e.active() && e.alive_count() == 0; }),
                    gs_particle_emitters_.end());
            }

            // Update VFX instances (timeline + emitters + animation tagging)
            if (flags.particles || flags.animation) {
                for (auto& inst : vfx_instances_) {
                    inst.update(dt, gs_active_buffer_, gs_animator_);
                }
                std::erase_if(vfx_instances_,
                    [](const VfxInstance& i) { return i.is_finished(); });
            }

            // Collect VFX dynamic lights and merge with existing lights
            {
                // Start from static scene lights (set via set_gs_static_lights)
                auto all_lights = gs_static_lights_;
                // Append VFX instance lights
                for (const auto& inst : vfx_instances_) {
                    for (const auto& vl : inst.active_lights()) {
                        if (all_lights.size() < 8) {
                            all_lights.push_back(vl);
                        }
                    }
                }
                if (!all_lights.empty()) {
                    // Auto-enable point light mode if VFX lights are present
                    if (gs_renderer_.light_mode() < 2) {
                        gs_renderer_.set_light_mode(2);
                    }
                    gs_renderer_.set_point_lights(all_lights);
                }
            }

            // Clamp to allocated SSBO capacity
            if (gs_active_buffer_.size() > gs_renderer_.max_gaussian_count()) {
                gs_active_buffer_.resize(gs_renderer_.max_gaussian_count());
            }

            gs_renderer_.update_gaussian_data(
                gs_active_buffer_.data(),
                static_cast<uint32_t>(gs_active_buffer_.size()));
        }

        gs_renderer_.render(cmd, gs_view_, gs_proj_);
    }
}

void Renderer::record_gs_blit(VkCommandBuffer cmd, const FeatureFlags& flags) {
    if (!(flags.gs_rendering && gs_initialized_ && gs_renderer_.has_cloud() && font_initialized_))
        return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, ui_pipeline_);
    sprite_batch_.bind(cmd, current_frame_);

    VkRect2D full_scissor{};
    full_scissor.offset = {0, 0};
    full_scissor.extent = swapchain_.extent();
    vkCmdSetScissor(cmd, 0, 1, &full_scissor);

    // Background behind GS (sky, mountains, etc.)
    if (gs_bg_initialized_) {
        SpriteDrawInfo bg_blit{};
        bg_blit.position = {
            static_cast<float>(kWindowWidth) * 0.5f,
            static_cast<float>(kWindowHeight) * 0.5f,
            0.0f
        };
        bg_blit.size = {
            static_cast<float>(kWindowWidth),
            static_cast<float>(kWindowHeight)
        };
        bg_blit.uv_min = {0.0f, 0.0f};
        bg_blit.uv_max = {1.0f, 1.0f};
        bg_blit.color = {1.0f, 1.0f, 1.0f, 1.0f};

        sprite_batch_.begin();
        sprite_batch_.draw(bg_blit);
        auto bg_flush = sprite_batch_.flush(current_frame_);
        if (bg_flush.index_count > 0) {
            vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                    sprite_pipeline_layout_, 0, 1,
                                    &gs_bg_descriptor_sets_[current_frame_], 0, nullptr);
            vkCmdDrawIndexed(cmd, bg_flush.index_count, 1, 0, bg_flush.vertex_offset, 0);
        }
    }

    // GS output on top (alpha-composited over background)
    SpriteDrawInfo gs_blit{};
    gs_blit.position = {
        static_cast<float>(kWindowWidth) * 0.5f + gs_blit_offset_x_,
        static_cast<float>(kWindowHeight) * 0.5f + gs_blit_offset_y_,
        0.0f
    };
    gs_blit.size = {
        static_cast<float>(kWindowWidth),
        static_cast<float>(kWindowHeight)
    };
    gs_blit.uv_min = {0.0f, 0.0f};
    gs_blit.uv_max = {1.0f, 1.0f};
    gs_blit.color = {1.0f, 1.0f, 1.0f, 1.0f};

    sprite_batch_.begin();
    sprite_batch_.draw(gs_blit);
    auto gs_flush = sprite_batch_.flush(current_frame_);
    if (gs_flush.index_count > 0) {
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                                sprite_pipeline_layout_, 0, 1,
                                &gs_ui_descriptor_sets_[current_frame_], 0, nullptr);
        vkCmdDrawIndexed(cmd, gs_flush.index_count, 1, 0, gs_flush.vertex_offset, 0);
    }
}


void Renderer::record_ui_pass(VkCommandBuffer cmd,
                               const std::vector<ui::UIDrawBatch>& ui_batches) {
    if (!font_initialized_ || ui_batches.empty()) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, ui_pipeline_);
    sprite_batch_.bind(cmd, current_frame_);

    VkRect2D full_scissor{};
    full_scissor.offset = {0, 0};
    full_scissor.extent = swapchain_.extent();

    float sx = static_cast<float>(swapchain_.extent().width) / static_cast<float>(kWindowWidth);
    float sy = static_cast<float>(swapchain_.extent().height) / static_cast<float>(kWindowHeight);

    for (const auto& batch : ui_batches) {
        if (batch.sprites.empty()) continue;

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

    vkCmdSetScissor(cmd, 0, 1, &full_scissor);
}

void Renderer::add_gs_particle_emitter(const GsEmitterConfig& config) {
    auto& emitter = gs_particle_emitters_.emplace_back();
    emitter.configure(config);
    emitter.set_active(true);
}

void Renderer::clear_gs_particle_emitters() {
    gs_particle_emitters_.clear();
}

void Renderer::add_gs_animation(const std::string& effect, const GsAnimRegion& region,
                                 float lifetime, bool loop, const GsAnimParams& params,
                                 const std::optional<ReformConfig>& reform) {
    SceneAnimation sa;
    sa.effect = effect;
    sa.region = region;
    sa.lifetime = lifetime;
    sa.loop = loop;
    sa.params = params;
    sa.reform = reform;
    if (!gs_scene_buffer_.empty()) {
        sa.group_id = gs_animator_.tag_region(
            gs_scene_buffer_, region, parse_effect_name(effect), lifetime, params);
    }
    gs_scene_animations_.push_back(std::move(sa));
}

void Renderer::clear_gs_animations() {
    gs_scene_animations_.clear();
}

void Renderer::add_vfx_instance(VfxInstance&& inst) {
    // Grow SSBO capacity to fit object PLY Gaussians
    const auto& obj_gs = inst.object_gaussians();
    if (!obj_gs.empty()) {
        uint32_t current_base = gs_renderer_.max_gaussian_count() - GsRenderer::kParticleHeadroom;
        uint32_t new_base = current_base + static_cast<uint32_t>(obj_gs.size());
        gs_renderer_.ensure_capacity(new_base);
        // Include in cached scene buffer so no per-frame append is needed
        gs_scene_buffer_.insert(gs_scene_buffer_.end(), obj_gs.begin(), obj_gs.end());
        std::fprintf(stderr, "VFX: Added %zu object Gaussians to scene buffer\n", obj_gs.size());
    }
    vfx_instances_.push_back(std::move(inst));
}

void Renderer::clear_vfx_instances() {
    vfx_instances_.clear();
    // Remove VFX object Gaussians from scene buffer (trim to pure-scene count)
    gs_scene_buffer_.resize(gs_scene_base_count_);
}

}  // namespace gseurat
