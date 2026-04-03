#pragma once

#include "gseurat/engine/buffer.hpp"
#include "gseurat/engine/camera.hpp"
#include "gseurat/engine/screenshot.hpp"
#include "gseurat/engine/gs_chunk_grid.hpp"
#include "gseurat/engine/gs_animator.hpp"
#include "gseurat/engine/gs_particle.hpp"
#include "gseurat/engine/gs_vfx.hpp"
#include "gseurat/engine/gs_renderer.hpp"
#include "gseurat/engine/command_pool.hpp"
#include "gseurat/engine/descriptor.hpp"
#include "gseurat/engine/font_atlas.hpp"
#include "gseurat/engine/post_process.hpp"
#include "gseurat/engine/render_pass.hpp"
#include "gseurat/engine/resource_handle.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/sprite_batch.hpp"
#include "gseurat/engine/swapchain.hpp"
#include "gseurat/engine/sync.hpp"
#include "gseurat/engine/texture.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/ui/ui_context.hpp"
#include "gseurat/engine/vk_context.hpp"

#include <array>
#include <functional>
#include <optional>
#include <string>
#include <vector>

struct GLFWwindow;

namespace gseurat {

class ResourceManager;

class Renderer {
public:
    void init(GLFWwindow* window, ResourceManager& resources);
    void init_font(const FontAtlas& atlas, ResourceManager& resources);
    void init_particles(ResourceManager& resources);
    void init_backgrounds(const std::vector<ResourceHandle<Texture>>& bg_textures);
    void init_shadows(ResourceManager& resources);
    void draw_frame();
    void init_gs(const GaussianCloud& cloud, uint32_t width = 320, uint32_t height = 240);
    void set_gs_background(const ResourceHandle<Texture>& texture);
    void set_gs_camera(const glm::mat4& view, const glm::mat4& proj) {
        gs_view_ = view; gs_proj_ = proj;
    }
    GsRenderer& gs_renderer() { return gs_renderer_; }
    GsChunkGrid& gs_chunk_grid() { return gs_chunk_grid_; }
    const GsChunkGrid& gs_chunk_grid() const { return gs_chunk_grid_; }
    bool has_gs_cloud() const { return gs_renderer_.has_cloud(); }
    void set_gs_skip_chunk_cull(bool skip) { gs_skip_chunk_cull_ = skip; }
    void set_gs_blit_offset(float x, float y) { gs_blit_offset_x_ = x; gs_blit_offset_y_ = y; }
    void set_gs_background_colors(const glm::vec3& ground, const glm::vec3& sky) {
        gs_bg_ground_color_ = ground;
        gs_bg_sky_color_ = sky;
        gs_bg_colors_enabled_ = (ground != glm::vec3(0.0f) || sky != glm::vec3(0.0f));
    }
    void set_gs_gaussian_budget(uint32_t b) { gs_gaussian_budget_ = b; }
    uint32_t gs_gaussian_budget() const { return gs_gaussian_budget_; }
    void set_gs_lod_focus(const glm::vec3& pos) { gs_lod_focus_pos_ = pos; gs_has_lod_focus_ = true; }
    void clear_gs_lod_focus() { gs_has_lod_focus_ = false; }

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

    void set_ca_intensity(float v) { ca_intensity_ = v; }
    void set_flash_color(float r, float g, float b) { flash_r_ = r; flash_g_ = g; flash_b_ = b; }
    void set_god_rays_intensity(float v) { god_rays_intensity_ = v; }
    float god_rays_intensity() const { return god_rays_intensity_; }

    PostProcessParams& post_process_params() { return pp_params_; }
    const PostProcessParams& post_process_params() const { return pp_params_; }

    // Gaussian particle emitters
    void add_gs_particle_emitter(const GsEmitterConfig& config);
    void clear_gs_particle_emitters();
    std::vector<GaussianParticleEmitter>& gs_particle_emitters() { return gs_particle_emitters_; }

    // Gaussian animator (animate existing scene Gaussians)
    GaussianAnimator& gs_animator() { return gs_animator_; }
    const std::vector<Gaussian>& gs_static_buffer() const { return gs_static_buffer_; }

    // Scene-placed animations (with loop support)
    struct ReformConfig {
        float lifetime = 2.0f;
    };
    struct SceneAnimation {
        std::string effect;
        GsAnimRegion region;
        float lifetime = 3.0f;
        bool loop = false;
        GsAnimParams params;
        std::optional<ReformConfig> reform;
        enum class Phase { Effect, Reforming, Idle };
        Phase phase = Phase::Effect;
        uint32_t group_id = 0;
        uint32_t reform_group_id = 0;
    };
    void add_gs_animation(const std::string& effect, const GsAnimRegion& region,
                          float lifetime, bool loop, const GsAnimParams& params = {},
                          const std::optional<ReformConfig>& reform = std::nullopt);
    void clear_gs_animations();
    const std::vector<SceneAnimation>& gs_scene_animations() const { return gs_scene_animations_; }

    // VFX instances (Méliès presets placed on map)
    void add_vfx_instance(VfxInstance&& inst);
    void clear_vfx_instances();
    const std::vector<VfxInstance>& vfx_instances() const { return vfx_instances_; }
    std::vector<VfxInstance>& vfx_instances_mutable() { return vfx_instances_; }
    void set_gs_static_lights(const std::vector<PointLight>& lights) { gs_static_lights_ = lights; }

    void request_screenshot(const std::string& path) { screenshot_.request(path); }
    bool screenshot_write_ok() const { return screenshot_.write_ok(); }
    uint32_t screenshot_width() const { return screenshot_.width(); }
    uint32_t screenshot_height() const { return screenshot_.height(); }

    VkContext& context() { return context_; }
    CommandPool& command_pool() { return command_pool_; }
    Swapchain& swapchain() { return swapchain_; }
    PostProcessPipeline& post_process() { return post_process_; }

    // Overlay callback: called after composite pass with (cmd, swapchain_image_index)
    // Used by Staging app to inject ImGui render pass
    using OverlayCallback = std::function<void(VkCommandBuffer, uint32_t)>;
    void set_overlay_callback(OverlayCallback cb) { overlay_callback_ = std::move(cb); }

private:
    void create_sprite_pipeline();
    void create_outline_pipeline();
    void create_ui_pipeline();
    void create_uniform_buffers();
    void update_uniform_buffer(uint32_t frame_index, const UniformBufferObject& ubo);

    void draw_sprite_pass(VkCommandBuffer cmd,
                          const std::vector<SpriteDrawInfo>& sprites,
                          VkDescriptorSet descriptor_set);
    void record_gs_prepass(VkCommandBuffer cmd, VkDevice device, float dt,
                           const FeatureFlags& flags);
    void record_gs_blit(VkCommandBuffer cmd, const FeatureFlags& flags);
    void record_ui_pass(VkCommandBuffer cmd,
                        const std::vector<ui::UIDrawBatch>& ui_batches);

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
    float ca_intensity_ = 0.0f;
    float flash_r_ = 0.0f;
    float flash_g_ = 0.0f;
    float flash_b_ = 0.0f;
    float god_rays_intensity_ = 0.0f;

    uint32_t current_frame_ = 0;
    uint32_t acquire_semaphore_index_ = 0;
    float last_time_ = 0.0f;
    bool font_initialized_ = false;

    // Gaussian splatting
    GsRenderer gs_renderer_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> gs_descriptor_sets_{};    // scene UBO (unused now)
    std::array<VkDescriptorSet, kMaxFramesInFlight> gs_ui_descriptor_sets_{}; // UI orthographic UBO
    bool gs_initialized_ = false;
    ResourceHandle<Texture> gs_bg_texture_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> gs_bg_descriptor_sets_{};
    bool gs_bg_initialized_ = false;

    // GS camera (3D perspective, independent of sprite camera)
    glm::mat4 gs_view_{1.0f};
    glm::mat4 gs_proj_{1.0f};
    glm::vec3 gs_bg_ground_color_{0.0f};
    glm::vec3 gs_bg_sky_color_{0.0f};
    bool gs_bg_colors_enabled_ = false;
    int light_glow_log_counter_ = 0;
    Texture white_pixel_tex_;
    std::array<VkDescriptorSet, kMaxFramesInFlight> white_pixel_descriptor_sets_{};
    bool white_pixel_initialized_ = false;
    uint32_t output_width_ = 320;
    uint32_t output_height_ = 240;

    // Spatial chunk grid for GS frustum culling
    GsChunkGrid gs_chunk_grid_;
    std::vector<Gaussian> gs_static_buffer_;
    std::vector<Gaussian> gs_dynamic_buffer_;
    glm::mat4 gs_prev_view_{0.0f};  // for camera dirty detection
    bool gs_static_force_dirty_ = false;
    std::vector<GaussianParticleEmitter> gs_particle_emitters_;
    GaussianAnimator gs_animator_;
    std::vector<SceneAnimation> gs_scene_animations_;
    std::vector<VfxInstance> vfx_instances_;
    std::vector<uint32_t> gs_prev_visible_;
    bool gs_skip_chunk_cull_ = false;
    uint32_t gs_gaussian_budget_ = 0;  // 0 = unlimited (no LOD decimation)
    uint32_t gs_total_gaussian_count_ = 0;  // total Gaussians in loaded cloud
    bool gs_adaptive_budget_ = false;
    bool gs_budget_locked_ = false;
    float gs_smoothed_fps_ = 60.0f;
    float gs_target_fps_ = 30.0f;
    uint32_t gs_stable_frame_count_ = 0;
    static constexpr uint32_t kGsBudgetMin = 200000;  // higher floor for quality
    static constexpr uint32_t kGsStableFramesNeeded = 30;  // ~0.5s at 60fps
    float gs_blit_offset_x_ = 0.0f;
    float gs_blit_offset_y_ = 0.0f;
    uint32_t gs_prev_budget_ = 0;
    glm::vec3 gs_lod_focus_pos_{0.0f};  // Player position for foveated LOD
    bool gs_has_lod_focus_ = false;
    std::vector<PointLight> gs_static_lights_;  // Scene-defined lights (for VFX light merging)

    // Persistent post-process params (modified by Staging panels)
    PostProcessParams pp_params_;

    // Screenshot capture
    ScreenshotCapture screenshot_;

    // Overlay callback (ImGui rendering hook)
    OverlayCallback overlay_callback_;
};

}  // namespace gseurat
