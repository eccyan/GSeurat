#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/debug.hpp"
#include "gseurat/engine/log.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/procedural_textures.hpp"
#include "gseurat/engine/project_root.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/scoped_timer.hpp"
#include "gseurat/engine/sort_entry.hpp"
#include "gseurat/engine/sort_hash.hpp"
#include "gseurat/engine/streaming_config.hpp"
#include "gseurat/engine/systems/lighting_system.hpp"
#include "gseurat/engine/systems/pbd_system.hpp"
#include "gseurat/engine/systems/vfx_system.hpp"

#include <cstdio>
#include <set>

#include <algorithm>
#include <array>
#include <chrono>
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

void Renderer::init(GLFWwindow* window, ResourceManager& resources,
                    const std::string& sprite_texture,
                    const std::string& tileset_texture,
                    const std::string& tileset_normal_texture,
                    const std::string& entity_normal_texture) {
    context_.init(window);
    swapchain_.init(context_, kWindowWidth, kWindowHeight);
    render_pass_mgr_.init(context_.device(), context_.allocator(), swapchain_);
    post_process_.init(context_.device(), context_.allocator(), swapchain_,
                       context_.pipeline_cache());
    command_pool_.init(context_.device(), context_.graphics_queue_family());
    sync_.init(context_.device(), swapchain_.image_count());
    descriptors_.init(context_.device());

    sprite_batch_.init(context_.allocator(), context_.device(), command_pool_.pool(),
                       context_.graphics_queue());

    create_uniform_buffers();

    resources.init(context_.device(), context_.allocator(), command_pool_.pool(),
                   context_.graphics_queue());

    test_texture_ = resources.load_texture(sprite_texture);
    tileset_texture_ = resources.load_texture(tileset_texture);

    // Load normal map textures (UNORM format — linear data, not sRGB).
    // The fallback flat normal is generated procedurally — it's a 1x1 pixel
    // with no artistic content, so there's no reason to ship it as a file.
    {
        auto data = procedural_textures::flat_normal();
        flat_normal_texture_ = resources.load_texture_from_memory(
            "engine/flat_normal", data.pixels.data(), data.width, data.height,
            VK_FILTER_NEAREST, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FORMAT_R8G8B8A8_UNORM);
    }
    tileset_normal_texture_ = resources.load_texture(tileset_normal_texture,
        VK_FILTER_NEAREST, VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE, VK_FORMAT_R8G8B8A8_UNORM);
    entity_normal_texture_ = resources.load_texture(entity_normal_texture,
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
    create_wireframe_pipeline();

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
    auto data = procedural_textures::particle_atlas();
    particle_texture_ = resources.load_texture_from_memory(
        "engine/particle_atlas", data.pixels.data(), data.width, data.height);

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
    auto data = procedural_textures::shadow_blob();
    shadow_texture_ = resources.load_texture_from_memory(
        "engine/shadow_blob", data.pixels.data(), data.width, data.height);

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
        gs_renderer_.init(context_.device(), context_.physical_device(),
                          context_.allocator(), VK_NULL_HANDLE,
                          context_.pipeline_cache());
        gs_initialized_ = true;

        // Opt-in pipeline pre-warm. Default OFF; user passes `--prewarm`
        // to populate the on-disk cache (#408 persists it across runs).
        // Per-pipeline serialization in `prewarm_pipelines` keeps Metal
        // PSO compiles single-file so peak memory pressure is bounded.
        // Always wrapped in try/catch — prewarm is an optimization, not a
        // correctness requirement; soft-fail just costs first-frame stalls.
        if (prewarm_at_startup_) {
            try {
                // `glfwPollEvents` keeps the window responsive while the
                // multi-second cold-cache prewarm runs on this thread.
                gs_renderer_.prewarm_pipelines(context_.graphics_queue(),
                                               command_pool_.pool(),
                                               []() { glfwPollEvents(); });
            } catch (const std::exception& e) {
                std::fprintf(stderr,
                    "[prewarm] init_gs caught: %s — continuing with cold cache\n",
                    e.what());
            }
            // Persist whatever warmed up immediately. The shutdown-time
            // save (#408) still runs on normal exit; this is belt-and-
            // suspenders for the regression-harness SIGTERM window.
            context_.save_pipeline_cache();
        }
    }

    // Pre-allocate streaming buffers once and stand up the transfer queue.
    // Both must be live before `load_cloud_async` so per-slab uploads can
    // route through the shared host-visible staging ring instead of the
    // legacy `vkCmdCopyBuffer` + `vkDeviceWaitIdle` path.
    if (!gs_renderer_.streaming_initialized()) {
        const auto& project_root = get_project_root();
        StreamingConfig cfg = project_root.empty()
            ? StreamingConfig{}
            : StreamingConfig::load(project_root);
        gs_renderer_.init_streaming(cfg);
        gs_renderer_.create_transfer_queue(
            context_.transfer_queue(),
            context_.transfer_queue_family(),
            context_.graphics_queue_family(),
            context_.has_dedicated_transfer());
    }

    gs_renderer_.resize_output(width, height);

    // Seed the GS output / processed / depth images into SHADER_READ_ONLY_OPTIMAL
    // so the very first frame can sample them safely even when the engine is
    // in EngineState::Loading and skips the GS compute path that would
    // normally perform this transition. Without this, sampling would fault
    // a Vulkan validation layer because the images sit in UNDEFINED.
    {
        VkCommandBuffer cmd = command_pool_.begin_single_time(context_.device());
        gs_renderer_.init_output_layouts(cmd);
        command_pool_.end_single_time(context_.device(), context_.graphics_queue(), cmd);
    }

    // CPU-side post-load setup (chunk grid, bounds, descriptor sets) reads
    // only the GaussianCloud — those run synchronously below, BEFORE we
    // hand the cloud over to the async upload. The loading monitor gates
    // GS compute via `dispatch_gpu_compute = false` until the returned
    // handles report Complete, so no shader will read stale slab buffers
    // while transfers are draining across frames.
    output_width_ = width;
    output_height_ = height;

    // Snapshot constant-size cloud metadata for demo-layer setup queries
    // (camera framing, ground-plane derivation). The Gaussians themselves
    // are NOT cached on the renderer — Option B per #396 §A: demos that
    // need the splats re-parse from disk via `GaussianCloud::load_with_gsvx_first`.
    gs_cloud_metadata_.bounds = cloud.bounds();
    gs_cloud_metadata_.gaussian_count = cloud.count();

    // Scene-load semantics are REPLACE: drop every chunk from the previous
    // scene before queuing the new cloud. `load_cloud_async` itself is
    // append-only (so streaming chunks can ride on top of an existing
    // world), so the replacement step lives at the call site. Without
    // this, a transition (seurat_island → dungeon) would visually
    // overlay both terrains and the smaller dungeon heightmap would
    // stop catching the player at its borders → the "floor gave way"
    // symptom.
    //
    // We hand `clear_chunks` a transient command buffer so its
    // poll_completions call can record acquire barriers from any
    // in-flight transfers on the dedicated transfer-family path.
    // Without a real cmd, those callbacks defer to the next frame
    // and would fire against the freshly-loaded scene's slab
    // indices, corrupting state. The single-queue path (Apple/
    // fallback) doesn't strictly need the cmd, but always providing
    // one keeps both code paths uniform.
    {
        VkCommandBuffer drain_cmd = command_pool_.begin_single_time(context_.device());
        gs_renderer_.clear_chunks(drain_cmd);
        command_pool_.end_single_time(context_.device(), context_.graphics_queue(), drain_cmd);
    }

    // Hand a copy of the cloud off to the renderer's pending-upload job.
    // The async path moves the cloud in and drains slab transfers across
    // frames via poll_transfers; the caller (`GsSceneLoader::load`) still
    // needs the original for PBD anchor uploads and bounds calculations
    // after `init_gs` returns, so we duplicate it here. The duplicate is
    // freed once the final completion callback fires.
    pending_load_handles_ = gs_renderer_.load_cloud_async(GaussianCloud(cloud));

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
    gs_descriptor_sets_ = descriptors_.allocate_sprite_sets_per_frame(
        context_.device(), ubo_buffers, sizeof(UniformBufferObject),
        gs_renderer_.output_views(), gs_renderer_.output_sampler(),
        flat_normal_texture_->image_view(), flat_normal_texture_->sampler());

    // Also create UI-space descriptor sets (orthographic projection for fullscreen blit)
    if (font_initialized_) {
        std::array<VkBuffer, kMaxFramesInFlight> ui_ubo_buffers;
        for (uint32_t i = 0; i < kMaxFramesInFlight; i++) {
            ui_ubo_buffers[i] = ui_uniform_buffers_[i].buffer();
        }
        gs_ui_descriptor_sets_ = descriptors_.allocate_sprite_sets_per_frame(
            context_.device(), ui_ubo_buffers, sizeof(UniformBufferObject),
            gs_renderer_.output_views(), gs_renderer_.output_sampler(),
            flat_normal_texture_->image_view(), flat_normal_texture_->sampler());
    }
}

void Renderer::drop_all_gs_chunks_now() {
    if (!gs_initialized_ || !gs_renderer_.streaming_initialized()) return;
    VkCommandBuffer drain_cmd = command_pool_.begin_single_time(context_.device());
    gs_renderer_.clear_chunks(drain_cmd);
    command_pool_.end_single_time(context_.device(), context_.graphics_queue(), drain_cmd);
}

void Renderer::begin_determinism_test(int frames) {
    if (frames <= 0) frames = 10;
    determinism_test_state_.active = true;
    determinism_test_state_.total_frames = frames;
    determinism_test_state_.captured_frames = 0;
    // Snapshot current camera matrices — `draw_scene` will replay these
    // for the next `frames` frames.
    determinism_test_state_.frozen_view = gs_view_;
    determinism_test_state_.frozen_proj = gs_proj_;

    determinism_test_result_ = {};
    determinism_test_result_.verdict = DeterminismVerdict::Running;
    determinism_test_result_.total_frames = frames;
    determinism_test_result_.hashes.reserve(static_cast<size_t>(frames));

    std::fprintf(stderr, "[GS det] determinism test started: frames=%d\n", frames);
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
                           const std::vector<DebugColliderDrawInfo>& debug_colliders_list,
                           const FeatureFlags& flags,
                           bool dispatch_gpu_compute) {
    GS_LOG_FRAME("[draw_scene/wd] entry current_frame={}", current_frame_);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_entry = std::chrono::steady_clock::now();
#endif
    auto device = context_.device();
    const auto& frame_sync = sync_.frame(current_frame_);

    // Delta time
    float now = static_cast<float>(glfwGetTime());
    float dt = now - last_time_;
    last_time_ = now;

    // Frame-determinism harness: when active, freeze every CPU-side input
    // that feeds the GS pipeline. Goal is to render N frames against
    // identical inputs so a hash drift in the post-Onesweep buffer
    // proves order-instability rather than legitimate per-frame change.
    const bool determinism_active = determinism_test_state_.active;
    if (determinism_active) {
        dt = 0.0f;                                 // freeze any dt-driven anim/PBD step
        gs_view_ = determinism_test_state_.frozen_view;
        gs_proj_ = determinism_test_state_.frozen_proj;
        // Ensure the camera-dirty path doesn't re-pick LOD/chunk visibility
        // each frame on micro-jitter from particle/VFX presence.
        gs_static_force_dirty_ = false;
        gs_renderer_.set_determinism_test_active(true);
    } else {
        gs_renderer_.set_determinism_test_active(false);
    }

    // Suppress camera shake if disabled (zero amplitude prevents shake math)
    if (!flags.camera_shake && camera_.shake_active()) {
        camera_.trigger_shake(0.0f, 0.0f, 0.0f);
    }
    camera_.update(dt);

#if GSEURAT_DEBUG_BUILD
    // Watchdog: bounded fence wait + retry, with timing log on stalls. The
    // diag build uses a 2-second timeout so a real hang surfaces immediately
    // via the SLOW log; on timeout, retry with UINT64_MAX so the demo keeps
    // running. Production builds skip this instrumentation and use the plain
    // UINT64_MAX path.
    constexpr uint64_t kFenceWaitWatchdogNs = 2'000'000'000ull; // 2 sec
    const auto fence_t0 = std::chrono::steady_clock::now();
    VkResult fence_result = vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE,
                                            kFenceWaitWatchdogNs);
    const auto fence_t1 = std::chrono::steady_clock::now();
    const double fence_ms = std::chrono::duration<double, std::milli>(fence_t1 - fence_t0).count();
    if (fence_result == VK_TIMEOUT) {
        std::fprintf(stderr,
            "[renderer/watchdog] vkWaitForFences TIMEOUT after %.2f ms (current_frame=%u) — "
            "main-thread blocked on prior frame's GPU work; retrying with infinite timeout\n",
            fence_ms, current_frame_);
        vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);
    } else if (fence_ms > 50.0) {
        GS_LOG_FRAME("[renderer/watchdog] vkWaitForFences slow: {:.2f} ms (current_frame={})",
                     fence_ms, current_frame_);
    }

    uint32_t image_index;
    auto acquire_sem = sync_.acquire_semaphore(acquire_semaphore_index_);
    const auto acquire_t0 = std::chrono::steady_clock::now();
    VkResult acquire_result = vkAcquireNextImageKHR(device, swapchain_.swapchain(),
                                                    kFenceWaitWatchdogNs, acquire_sem,
                                                    VK_NULL_HANDLE, &image_index);
    const auto acquire_t1 = std::chrono::steady_clock::now();
    const double acquire_ms = std::chrono::duration<double, std::milli>(acquire_t1 - acquire_t0).count();
    if (acquire_result == VK_TIMEOUT) {
        std::fprintf(stderr,
            "[renderer/watchdog] vkAcquireNextImageKHR TIMEOUT after %.2f ms — "
            "swapchain image not available; retrying with infinite timeout\n",
            acquire_ms);
        vkAcquireNextImageKHR(device, swapchain_.swapchain(), UINT64_MAX, acquire_sem,
                              VK_NULL_HANDLE, &image_index);
    } else if (acquire_ms > 50.0) {
        GS_LOG_FRAME("[renderer/watchdog] vkAcquireNextImageKHR slow: {:.2f} ms", acquire_ms);
    }
#else
    vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);

    uint32_t image_index;
    auto acquire_sem = sync_.acquire_semaphore(acquire_semaphore_index_);
    vkAcquireNextImageKHR(device, swapchain_.swapchain(), UINT64_MAX, acquire_sem,
                          VK_NULL_HANDLE, &image_index);
#endif
    acquire_semaphore_index_ =
        (acquire_semaphore_index_ + 1) % sync_.acquire_semaphore_count();

    vkResetFences(device, 1, &frame_sync.in_flight);

    auto cmd = command_pool_.command_buffer(current_frame_);
    vkResetCommandBuffer(cmd, 0);

    VkCommandBufferBeginInfo begin_info{};
    begin_info.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    vkBeginCommandBuffer(cmd, &begin_info);

    // Drain completed async transfers: retires fences, fires per-handle and
    // batch completion callbacks (which write page/chunk tables, set
    // gaussian_count_, etc.), and on the dedicated-transfer-family path
    // records acquire barriers into `cmd` so subsequent GS compute reads
    // see fully-uploaded slabs. Must run before any pipeline that consumes
    // the slab buffers, including `record_gs_prepass`.
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_poll = std::chrono::steady_clock::now();
#endif
    gs_renderer_.poll_transfers(cmd, current_frame_);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_poll = std::chrono::steady_clock::now();
#endif

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
        // Scene-transition overlay (forwarded from PostProcessParams)
        gs_pp.overlay_r = pp_params_.overlay_r;
        gs_pp.overlay_g = pp_params_.overlay_g;
        gs_pp.overlay_b = pp_params_.overlay_b;
        gs_pp.overlay_alpha = pp_params_.overlay_alpha;
        gs_pp.overlay_effect_type = pp_params_.overlay_effect_type;
        // Hybrid background colors
        gs_pp.ground_color = gs_bg_ground_color_;
        gs_pp.sky_color = gs_bg_sky_color_;
        gs_pp.background_enabled = gs_bg_colors_enabled_;
        if (gs_bg_colors_enabled_) {
            // Compute horizon Y from camera: project a ground-plane point far ahead
            glm::vec3 cam_pos = glm::vec3(glm::inverse(gs_view_)[3]);
            glm::vec3 forward = -glm::vec3(gs_view_[0][2], gs_view_[1][2], gs_view_[2][2]);
            glm::vec3 horizon_world = glm::vec3(
                cam_pos.x + forward.x * 100.0f,
                0.0f,  // ground Y
                cam_pos.z + forward.z * 100.0f
            );
            glm::vec4 clip = gs_proj_ * gs_view_ * glm::vec4(horizon_world, 1.0f);
            if (std::abs(clip.w) > 0.001f) {
                float ndc_y = clip.y / clip.w;
                // Vulkan NDC with Y-flip: ndc_y=-1 is top, ndc_y=+1 is bottom
                gs_pp.horizon_y = (ndc_y + 1.0f) * 0.5f;
                gs_pp.horizon_y = glm::clamp(gs_pp.horizon_y, 0.0f, 1.0f);
            }
        }
        gs_renderer_.set_post_process_params(gs_pp);
    }

#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_prepass = std::chrono::steady_clock::now();
#endif
    record_gs_prepass(cmd, device, dt, flags, dispatch_gpu_compute);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_prepass = std::chrono::steady_clock::now();
#endif

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

        // Debug collider wireframes (after all sprite passes, before end render pass)
        if (flags.debug_colliders && !debug_colliders_list.empty()) {
            draw_debug_colliders(cmd, debug_colliders_list);
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

#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_pp = std::chrono::steady_clock::now();
#endif
    post_process_.record_post_process(cmd, image_index, pp_params);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_pp = std::chrono::steady_clock::now();
#endif

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

#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_end = std::chrono::steady_clock::now();
#endif
    vkEndCommandBuffer(cmd);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_end = std::chrono::steady_clock::now();
#endif

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

#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_submit = std::chrono::steady_clock::now();
#endif
    if (vkQueueSubmit(context_.graphics_queue(), 1, &submit, frame_sync.in_flight) != VK_SUCCESS) {
        throw std::runtime_error("Failed to submit draw command buffer");
    }
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_submit = std::chrono::steady_clock::now();
#endif

    // Screenshot readback: wait for GPU, swizzle BGRA→RGBA, write PNG
    if (screenshot_requested) {
        vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);
        screenshot_.readback_and_write(context_.allocator(), swapchain_.extent());
    }

    // Frame-determinism harness: after the GPU finishes this frame, hash
    // the live entries in the post-Onesweep readback. Debug-only — blocking
    // on the in-flight fence is fine here.
    //
    // Codex P1.1 / P1.3 / P2.4 hardening:
    //  * vmaInvalidateAllocation on both the count counter and the readback
    //    buffer before reading their mapped data, in case VMA picked a
    //    non-HOST_COHERENT memory type (would otherwise read stale CPU
    //    cache lines and produce false STABLE/UNSTABLE verdicts).
    //  * Clamp live_count against tile_sort_capacity. The legacy `atomicAdd`
    //    in gs_tile_bin.comp can leave the counter beyond capacity in
    //    overflow scenarios; without clamping the hash range would slide
    //    past the end of the host-mapped buffer.
    //  * Skip the frame entirely if `dispatch_tile_sort` did not actually
    //    record a readback this frame (loading / scene-transition / no
    //    cloud / tile-binning disabled). Otherwise the hash would be
    //    computed against stale or zero contents and could produce a
    //    bogus STABLE verdict.
    if (determinism_active) {
        vkWaitForFences(device, 1, &frame_sync.in_flight, VK_TRUE, UINT64_MAX);

        if (!gs_renderer_.determinism_readback_emitted_this_frame()) {
            // Readback wasn't emitted (GS path was gated off). Don't pollute
            // the verdict with stale-buffer hashes — just keep waiting for
            // a real frame. Logging here is intentionally chatty so a stuck
            // test is easy to diagnose from the demo log.
            std::fprintf(stderr,
                         "[GS det] frame skipped (no tile-sort readback this frame; "
                         "GS path likely gated off — waiting for a real frame)\n");
        } else {
            VmaAllocator allocator = context_.allocator();
            if (auto count_alloc = gs_renderer_.tile_sort_count_allocation()) {
                vmaInvalidateAllocation(allocator, count_alloc, 0, VK_WHOLE_SIZE);
            }
            if (auto readback_alloc = gs_renderer_.determinism_readback_allocation()) {
                vmaInvalidateAllocation(allocator, readback_alloc, 0, VK_WHOLE_SIZE);
            }

            const uint32_t raw_live_count = gs_renderer_.live_tile_sort_count();
            const uint32_t capacity = gs_renderer_.tile_sort_capacity();
            const uint32_t live_count =
                (capacity > 0) ? std::min(raw_live_count, capacity) : raw_live_count;
            const void* mapped = gs_renderer_.determinism_readback_data();
            std::uint64_t hash = 0;
            if (mapped != nullptr && live_count > 0) {
                hash = fnv1a_64(static_cast<const std::uint8_t*>(mapped),
                                static_cast<std::size_t>(live_count) * sizeof(SortEntry));
            }
            determinism_test_result_.hashes.push_back(hash);
            determinism_test_result_.live_entry_count = live_count;
            determinism_test_result_.captured_frames = ++determinism_test_state_.captured_frames;
            std::fprintf(stderr,
                         "[GS det] frame %d/%d hash=0x%016llx live=%u (raw=%u capacity=%u)\n",
                         determinism_test_state_.captured_frames,
                         determinism_test_state_.total_frames,
                         static_cast<unsigned long long>(hash), live_count,
                         raw_live_count, capacity);
            if (determinism_test_state_.captured_frames >= determinism_test_state_.total_frames) {
                std::set<std::uint64_t> unique(determinism_test_result_.hashes.begin(),
                                               determinism_test_result_.hashes.end());
                determinism_test_result_.unique_hashes = static_cast<uint32_t>(unique.size());
                determinism_test_result_.verdict = (unique.size() <= 1)
                    ? DeterminismVerdict::Stable
                    : DeterminismVerdict::Unstable;
                determinism_test_state_.active = false;
                gs_renderer_.set_determinism_test_active(false);
                std::fprintf(stderr,
                             "[GS det] verdict=%s unique=%u/%d\n",
                             (determinism_test_result_.verdict == DeterminismVerdict::Stable)
                                 ? "STABLE" : "UNSTABLE",
                             determinism_test_result_.unique_hashes,
                             determinism_test_result_.total_frames);
            }
        }
    }

    VkPresentInfoKHR present{};
    present.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    present.waitSemaphoreCount = 1;
    present.pWaitSemaphores = &render_done_sem;
    present.swapchainCount = 1;
    auto sc = swapchain_.swapchain();
    present.pSwapchains = &sc;
    present.pImageIndices = &image_index;

#if GSEURAT_DEBUG_BUILD
    const auto t_ds_pre_present = std::chrono::steady_clock::now();
#endif
    vkQueuePresentKHR(context_.graphics_queue(), &present);
#if GSEURAT_DEBUG_BUILD
    const auto t_ds_post_present = std::chrono::steady_clock::now();

    const double draw_total_ms = std::chrono::duration<double, std::milli>(
        t_ds_post_present - t_ds_entry).count();
    if (draw_total_ms > 100.0) {
        const double setup_ms = std::chrono::duration<double, std::milli>(
            t_ds_pre_poll - t_ds_entry).count();
        const double poll_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_poll - t_ds_pre_poll).count();
        const double submit_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_submit - t_ds_pre_submit).count();
        const double post_submit_to_present_ms = std::chrono::duration<double, std::milli>(
            t_ds_pre_present - t_ds_post_submit).count();
        const double present_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_present - t_ds_pre_present).count();
        const double prepass_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_prepass - t_ds_pre_prepass).count();
        const double prepass_to_pp_ms = std::chrono::duration<double, std::milli>(
            t_ds_pre_pp - t_ds_post_prepass).count();
        const double post_process_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_pp - t_ds_pre_pp).count();
        const double pp_to_end_ms = std::chrono::duration<double, std::milli>(
            t_ds_pre_end - t_ds_post_pp).count();
        const double end_cmdbuf_ms = std::chrono::duration<double, std::milli>(
            t_ds_post_end - t_ds_pre_end).count();
        GS_LOG_FRAME("[draw_scene/wd/SLOW] frame={} total={:.1f}ms "
                     "setup={:.1f} poll_xfers={:.1f} gs_prepass={:.1f} scene_pass={:.1f} post_process={:.1f} composite={:.1f} end_cmdbuf={:.1f} "
                     "submit={:.1f} post_submit={:.1f} present={:.1f}",
                     current_frame_, draw_total_ms,
                     setup_ms, poll_ms, prepass_ms, prepass_to_pp_ms, post_process_ms, pp_to_end_ms, end_cmdbuf_ms,
                     submit_ms, post_submit_to_present_ms, present_ms);
    }
#endif

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
    // Persist the pipeline cache to disk BEFORE vkDeviceWaitIdle and any
    // teardown work. Otherwise the SIGTERM→SIGKILL window driven by the
    // regression harness (5 s) can expire while waiting for in-flight GPU
    // work or destroying textures, and the cache is lost — forcing every
    // harness run to recompile every PSO from scratch on first dispatch
    // (#405). vkGetPipelineCacheData is a CPU-side query against the
    // driver's cache state and does NOT require a device idle.
    context_.save_pipeline_cache();

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
    if (wireframe_pipeline_ != VK_NULL_HANDLE) {
        vkDestroyPipeline(context_.device(), wireframe_pipeline_, nullptr);
    }
    if (wireframe_pipeline_layout_ != VK_NULL_HANDLE) {
        vkDestroyPipelineLayout(context_.device(), wireframe_pipeline_layout_, nullptr);
    }
    if (wireframe_vb_ != VK_NULL_HANDLE) {
        vmaDestroyBuffer(context_.allocator(), wireframe_vb_, wireframe_vb_alloc_);
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
                           .build(device, context_.pipeline_cache());

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
                            .build(device, context_.pipeline_cache());

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
                       .build(device, context_.pipeline_cache());

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
                                  const FeatureFlags& flags,
                                  bool dispatch_gpu_compute) {
#if GSEURAT_DEBUG_BUILD
    const auto t_prepass_start = std::chrono::steady_clock::now();
    uint32_t dbg_dyn_count = 0;
#endif
    // Adaptive GS budget: converge to target FPS then lock
    if (flags.gs_adaptive_budget && gs_adaptive_budget_ && gs_gaussian_budget_ > 0 && dt > 0.0f) {
        float fps = 1.0f / dt;
        gs_smoothed_fps_ = gs_smoothed_fps_ * 0.9f + fps * 0.1f;

        if (!gs_budget_locked_) {
            if (gs_smoothed_fps_ < gs_target_fps_) {
                float scale = gs_smoothed_fps_ / gs_target_fps_;
                gs_gaussian_budget_ = std::max(kGsBudgetMin,
                    static_cast<uint32_t>(gs_gaussian_budget_ * scale));
                gs_stable_frame_count_ = 0;
            } else {
                gs_stable_frame_count_++;
                if (gs_stable_frame_count_ >= kGsStableFramesNeeded) {
                    gs_budget_locked_ = true;
                }
            }
        }
    }

    // Gaussian splatting compute (before render pass).
    // Gated on `dispatch_gpu_compute` so the engine's Loading state can keep
    // the GPU idle while the loading screen draws. Warming intentionally
    // keeps this true so the driver finalises pipeline/state setup against
    // the freshly-uploaded buffers before the player starts seeing frames.
    if (dispatch_gpu_compute && flags.gs_rendering && gs_initialized_ && gs_renderer_.has_cloud()) {

        // --- Static path: rebuild on camera dirty ---
        bool budget_changed = (gs_gaussian_budget_ != gs_prev_budget_);
        if (budget_changed) {
            gs_prev_budget_ = gs_gaussian_budget_;
        }

        bool camera_dirty = (gs_view_ != gs_prev_view_) || budget_changed || gs_static_force_dirty_;

        // If scene animations are active, force static rebuild each frame.
        // Phase 4c-vfx-2: VFX animator state moved to VfxSystem and writes
        // to vfx_buffer (dynamic-side, via compose pass), so we no longer
        // arm static-dirty from animator activity.
        if (!gs_scene_animations_.empty()) {
            gs_static_force_dirty_ = true;
            camera_dirty = true;
        }

        // Dynamic presence (particles, VFX, pending dynamic appends) does NOT
        // imply static-dirty. The renderer's split-tail design keeps static
        // and dynamic in disjoint regions of `projected` and disjoint slots
        // of `counts`:
        //   projected[0 .. max_static_count)         — static, gated on static_dirty_
        //   projected[max_static_count .. +dynamic)  — dynamic, written every frame
        //   counts[0]=static_visible, counts[1]=dynamic_visible, counts[2]=merged
        // Phase 1 (dynamic preprocess+sort) and Phase 2 (static preprocess+sort)
        // touch disjoint regions; Phase 3 (merge) reads both and is re-run every
        // frame, so dropping the static rebuild while a VFX is alive is safe.
        // Option A (2026-05-11): PBD-tagged splats now live in the dynamic
        // prefix alongside characters/NPCs. The dynamic preprocess runs every
        // frame anyway, so PBD wind sway is visible without arming
        // `static_dirty_` — and the static sort can stay cached until the
        // camera actually moves.

        // Determinism harness: hold the LOD/chunk-gather selection across
        // frames so the pre-sort input set itself is bit-identical. Any
        // change here would mask the order-instability we're trying to
        // detect downstream in the tile-bin atomic.
        if (determinism_test_state_.active) {
            camera_dirty = false;
            gs_static_force_dirty_ = false;
        }

        // Camera-dirty refresh: arm the per-frame static preprocess gate.
        // GsRenderer::render() gates static preprocess on `static_dirty_`.
        // Only chunk publications re-arm it automatically (PBD now lives in
        // dynamic under Option A and no longer touches `static_dirty_`) — so
        // a streamed scene would freeze static projections between chunk
        // events as the camera moves. Force the flag on every camera-dirty
        // frame so streaming scenes stay responsive. Source: codex P1 review
        // on PR #388.
        if (camera_dirty) {
            gs_renderer_.set_static_dirty(true);
            gs_prev_view_ = gs_view_;
            gs_static_force_dirty_ = false;
        }

        // --- Dynamic path: every frame ---
        // Determinism harness: when a Mode-1 test is active, skip the
        // entire dynamic-buffer rebuild. The GPU's dynamic_gaussian_ssbo
        // and dynamic_count_ retain whatever was uploaded just before the
        // test began, so every replayed frame sees identical dynamic
        // input. We can't just rely on `dt = 0` here — emitter.update
        // and inst.update may rebuild internal state non-deterministically
        // (particle re-emission ordering, std::erase_if removal of dead
        // entries reshuffling indices), and the std::vector clear+fill
        // pattern would change capacity allocations across frames.
        // Phase 4c-vfx-2 / 4c-pbd: VFX + PBD splats now go through their
        // respective systems → vfx_buffer / pbd_buffer (RenderState) →
        // GPU compose passes → dynamic_gaussian_ssbo. We need both
        // counts BEFORE update_dynamic_gaussians so its gpu_prefix is
        // right. Distance-cull origin computed once and reused below
        // (PBD doesn't distance-cull — its CPU producers can if they care).
        const glm::vec3 cull_origin_v = glm::vec3(glm::inverse(gs_view_)[3]);
        const float cull_dist_sq_v = gs_max_render_distance_ > 0.0f
            ? gs_max_render_distance_ * gs_max_render_distance_ : 0.0f;
        uint32_t vfx_count = 0;
        if (vfx_system_ && !determinism_test_state_.active) {
            vfx_count = vfx_system_->update_per_frame(
                dt, FrameIndex{current_frame_}, cull_origin_v, cull_dist_sq_v,
                flags.animation, flags.particles);
        }
        uint32_t pbd_count = 0;
        if (pbd_system_ && !determinism_test_state_.active) {
            pbd_count = pbd_system_->update_per_frame(FrameIndex{current_frame_});
        }
        // Clamp the GPU-composed prefix so persistent + vfx + pbd fits
        // inside max_dynamic_count_. Without this the compose shaders
        // would write past `dynamic_gaussian_ssbo`'s end when a scene's
        // persistent prefix is large enough to leave less headroom than
        // the system writer caps (RenderStateConfig max_vfx_splats +
        // max_pbd_splats currently 250k vs. kDynamicHeadroom 1M minus
        // persistent). The old pending-dynamics path was implicitly
        // clipped by update_dynamic_gaussians, which can only truncate
        // the CPU portion (after the GPU prefix) — Codex P2 on #437.
        {
            const uint32_t max_dyn = gs_renderer_.max_dynamic_count();
            const uint32_t persistent = gs_renderer_.persistent_dynamic_count();
            uint32_t gpu_budget = (max_dyn > persistent) ? (max_dyn - persistent) : 0;
            if (vfx_count > gpu_budget) vfx_count = gpu_budget;
            gpu_budget -= vfx_count;
            if (pbd_count > gpu_budget) pbd_count = gpu_budget;
        }

        if (!determinism_test_state_.active) {
            gs_dynamic_buffer_.clear();

            if (!gs_scene_animations_.empty()) {
                // Phase 2 deferred: scene animations on streamed terrain
                // need GPU-side region tagging (compute shader) since the
                // terrain has no CPU mirror. Soft-disable for now: drop
                // queued animations and log once per batch so we know they
                // were skipped. Affected effects (pulse / burn / swirl on
                // terrain regions) won't render until the compute path
                // lands. Triggers themselves still fire normally.
                std::fprintf(stderr,
                    "[scene-animations] WARN: skipped %zu scene animation(s) "
                    "— GPU-side region tagging not yet implemented "
                    "(Phase 2 follow-up).\n",
                    gs_scene_animations_.size());
                gs_scene_animations_.clear();
            }

            // Update and gather Gaussian particles from emitters
            // (VFX iteration above wrote to vfx_buffer; emitters still
            // write to gs_dynamic_buffer_ → slots after the VFX prefix.)
            if (flags.particles) {
                for (auto& emitter : gs_particle_emitters_) {
                    emitter.update(dt);
                    if (cull_dist_sq_v > 0.0f) {
                        glm::vec3 d = emitter.position() - cull_origin_v;
                        if (glm::dot(d, d) > cull_dist_sq_v) continue;
                    }
                    emitter.gather(gs_dynamic_buffer_);
                }
                gs_particle_emitters_.erase(
                    std::remove_if(gs_particle_emitters_.begin(), gs_particle_emitters_.end(),
                        [](const GaussianParticleEmitter& e) { return !e.active() && e.alive_count() == 0; }),
                    gs_particle_emitters_.end());
            }

            // Phase 4d-2: static + VFX-emitted light merge moved into
            // systems::LightingSystem. Falls through harmlessly if the
            // system isn't bound (tests / standalone harness).
            if (lighting_system_) {
                lighting_system_->update_per_frame();
            }

            // Upload dynamic Gaussians. The dynamic_gaussian_ssbo layout
            // is now [persistent | vfx | pbd | cpu]: `vfx_count` and
            // `pbd_count` slots are filled by the GPU compose passes
            // below, and `count` CPU-sourced slots come after.
            {
                auto count = static_cast<uint32_t>(gs_dynamic_buffer_.size());
                const uint32_t gpu_prefix = vfx_count + pbd_count;
                const uint32_t max_cpu = (gs_renderer_.max_dynamic_count() > gpu_prefix)
                    ? gs_renderer_.max_dynamic_count() - gpu_prefix : 0;
                if (count > max_cpu) {
                    gs_dynamic_buffer_.resize(max_cpu);
                    count = max_cpu;
                }
                gs_renderer_.update_dynamic_gaussians(gs_dynamic_buffer_.data(), count,
                                                       /*gpu_prefix=*/gpu_prefix);
#if GSEURAT_DEBUG_BUILD
                dbg_dyn_count = count + gpu_prefix;
#endif
            }
        }

        // Phase 4c-vfx-2 / 4c-pbd: GPU compose passes — copy VfxSystem's
        // per-frame vfx_buffer into dynamic_gaussian_ssbo at offset
        // persistent_dyn_count_ for `vfx_count` slots, then PbdSystem's
        // pbd_buffer at offset persistent_dyn_count_ + vfx_count. Both
        // must run on the same cmd buffer BEFORE gs_renderer_.render()
        // so downstream preprocess/sort/raster see the composed splats.
        // Order matters because dispatch_compose_pbd uses vfx_count as
        // an offset.
        gs_renderer_.dispatch_compose_vfx(cmd, FrameIndex{current_frame_}, vfx_count);
        gs_renderer_.dispatch_compose_pbd(cmd, FrameIndex{current_frame_},
                                          vfx_count, pbd_count);

#if GSEURAT_DEBUG_BUILD
        const auto t_prepass_pre_render = std::chrono::steady_clock::now();
#endif
        gs_renderer_.render(cmd, current_frame_, gs_view_, gs_proj_);
#if GSEURAT_DEBUG_BUILD
        const auto t_prepass_end = std::chrono::steady_clock::now();

        const double total_ms = std::chrono::duration<double, std::milli>(
            t_prepass_end - t_prepass_start).count();
        if (total_ms > 100.0) {
            const double cpu_gather_ms = std::chrono::duration<double, std::milli>(
                t_prepass_pre_render - t_prepass_start).count();
            const double gs_render_ms = std::chrono::duration<double, std::milli>(
                t_prepass_end - t_prepass_pre_render).count();
            const size_t emitter_count = gs_particle_emitters_.size();
            const size_t vfx_inst_count = vfx_system_ ? vfx_system_->instances().size() : 0;
            GS_LOG_FRAME("[gs_prepass/wd/SLOW] total={:.1f}ms cpu_gather={:.1f} gs_render={:.1f} "
                         "dyn_count={} emitters={} vfx_inst={} static_dirty={}",
                         total_ms, cpu_gather_ms, gs_render_ms, dbg_dyn_count,
                         emitter_count, vfx_inst_count, gs_static_force_dirty_ ? 1 : 0);
        }
#endif
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

void Renderer::create_wireframe_pipeline() {
    auto device = context_.device();

    // Generate wireframe meshes
    wireframe_meshes_ = generate_wireframe_meshes();

    // Create vertex buffer (host-visible for simplicity — small data, created once)
    VkBufferCreateInfo buf_info{};
    buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
    buf_info.size = wireframe_meshes_.vertices.size() * sizeof(glm::vec3);
    buf_info.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
    buf_info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_AUTO;
    alloc_info.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                       VMA_ALLOCATION_CREATE_MAPPED_BIT;

    VmaAllocationInfo alloc_result;
    vmaCreateBuffer(context_.allocator(), &buf_info, &alloc_info,
                    &wireframe_vb_, &wireframe_vb_alloc_, &alloc_result);

    // Upload vertex data
    std::memcpy(alloc_result.pMappedData, wireframe_meshes_.vertices.data(),
                wireframe_meshes_.vertices.size() * sizeof(glm::vec3));

    // Create pipeline layout with push constants
    VkPushConstantRange push_range{};
    push_range.stageFlags = VK_SHADER_STAGE_VERTEX_BIT;
    push_range.offset = 0;
    push_range.size = 112;  // mat4(64) + vec4(16) + vec4(16) + vec4(16)

    VkPipelineLayoutCreateInfo layout_info{};
    layout_info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
    auto desc_layout = descriptors_.sprite_layout();
    layout_info.setLayoutCount = 1;
    layout_info.pSetLayouts = &desc_layout;
    layout_info.pushConstantRangeCount = 1;
    layout_info.pPushConstantRanges = &push_range;

    vkCreatePipelineLayout(device, &layout_info, nullptr, &wireframe_pipeline_layout_);

    // Load shaders
    auto vert = load_shader_module(device, "shaders/debug_wireframe.vert.spv");
    auto frag = load_shader_module(device, "shaders/debug_wireframe.frag.spv");

    // Vertex input: just vec3 position
    VkVertexInputBindingDescription binding{};
    binding.binding = 0;
    binding.stride = sizeof(glm::vec3);
    binding.inputRate = VK_VERTEX_INPUT_RATE_VERTEX;

    VkVertexInputAttributeDescription attr{};
    attr.binding = 0;
    attr.location = 0;
    attr.format = VK_FORMAT_R32G32B32_SFLOAT;
    attr.offset = 0;

    // Build pipeline
    wireframe_pipeline_ = PipelineBuilder()
        .set_shaders(vert, frag)
        .set_vertex_input(binding, &attr, 1)
        .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_LINE_LIST)
        .set_viewport_scissor(swapchain_.extent())
        .set_rasterizer(VK_POLYGON_MODE_LINE, VK_CULL_MODE_NONE)
        .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
        .set_depth_stencil(true, false)  // read depth, don't write
        .set_color_blend_alpha()
        .set_layout(wireframe_pipeline_layout_)
        .set_render_pass(post_process_.scene_render_pass(), 0)
        .build(device, context_.pipeline_cache());

    vkDestroyShaderModule(device, frag, nullptr);
    vkDestroyShaderModule(device, vert, nullptr);
}

void Renderer::draw_debug_colliders(VkCommandBuffer cmd,
                                     const std::vector<DebugColliderDrawInfo>& draw_list) {
    if (draw_list.empty() || wireframe_pipeline_ == VK_NULL_HANDLE) return;

    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, wireframe_pipeline_);

    // Bind the same UBO descriptor set (set 0) — shares VP matrix
    vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS,
                            wireframe_pipeline_layout_, 0, 1,
                            &descriptor_sets_[current_frame_], 0, nullptr);

    // Bind wireframe vertex buffer
    VkDeviceSize offset = 0;
    vkCmdBindVertexBuffers(cmd, 0, 1, &wireframe_vb_, &offset);

    for (const auto& info : draw_list) {
        // Push constants
        struct PushConstants {
            glm::mat4 model;
            glm::vec4 color;
            glm::vec4 shape_params;  // type, radius, half_height, 0
            glm::vec4 extents;       // half_extents.xyz, 0
        } pc;

        pc.model = info.model;
        pc.color = info.color;
        pc.shape_params = glm::vec4(
            static_cast<float>(static_cast<uint8_t>(info.shape_type)),
            info.radius, info.half_height, 0.0f);
        pc.extents = glm::vec4(info.half_extents, 0.0f);

        vkCmdPushConstants(cmd, wireframe_pipeline_layout_,
                           VK_SHADER_STAGE_VERTEX_BIT, 0, sizeof(pc), &pc);

        // Select mesh range
        WireframeMeshRange range{};
        switch (info.shape_type) {
            case ColliderType::Box:     range = wireframe_meshes_.cube; break;
            case ColliderType::Sphere:  range = wireframe_meshes_.sphere; break;
            case ColliderType::Capsule: range = wireframe_meshes_.capsule; break;
        }

        vkCmdDraw(cmd, range.count, 1, range.offset, 0);
    }

    // Re-bind sprite pipeline for any subsequent passes
    vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, sprite_pipeline_);
    sprite_batch_.bind(cmd, current_frame_);
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
    gs_scene_animations_.push_back(std::move(sa));
}

void Renderer::clear_gs_animations() {
    gs_scene_animations_.clear();
}

}  // namespace gseurat
