#pragma once

#include "gseurat/engine/async_loader.hpp"
#include "gseurat/engine/audio/audio_engine.hpp"
#include "gseurat/engine/component_registry.hpp"
#include "gseurat/engine/engine_state.hpp"
#include "gseurat/engine/system_scheduler.hpp"
#include "gseurat/engine/control_server.hpp"
#include "gseurat/engine/collision_gen.hpp"
#include "gseurat/engine/command_context.hpp"
#include "gseurat/engine/command_dispatcher.hpp"
#include "gseurat/engine/debug_dump.hpp"
#include "gseurat/engine/dev_overlay.hpp"
#include "gseurat/engine/coordinate.hpp"
#include "gseurat/engine/gaussian_cloud.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/day_night_system.hpp"
#include "gseurat/engine/dialog.hpp"
#include "gseurat/engine/direction.hpp"
#include "gseurat/engine/draw_lists.hpp"
#include "gseurat/engine/ecs/default_components.hpp"
#include "gseurat/engine/ecs/ecs.hpp"
#include "gseurat/engine/feature_flags.hpp"
#include "gseurat/engine/gs_scene_loader.hpp"
#include "gseurat/engine/font_atlas.hpp"
#include "gseurat/engine/game_state.hpp"
#include "gseurat/engine/gameplay_state.hpp"
#include "gseurat/engine/gs_terrain_state.hpp"
#include "gseurat/engine/bone_animation_registry.hpp"
#include "gseurat/engine/input_manager.hpp"
#include "gseurat/engine/locale_manager.hpp"
#include "gseurat/engine/minimap.hpp"
#include "gseurat/engine/particle.hpp"
#include "gseurat/engine/render_state.hpp"
#include "gseurat/engine/renderer.hpp"
#include "gseurat/engine/resource_manager.hpp"
#include "gseurat/engine/save_system.hpp"
#include "gseurat/engine/gs_parallax_camera.hpp"
#include "gseurat/engine/scene_loader.hpp"
#include "gseurat/engine/scene_object_state.hpp"
#include "gseurat/engine/staging_uploader.hpp"
#include "gseurat/engine/scene.hpp"
#include "gseurat/engine/screen_effects.hpp"
#include "gseurat/engine/systems/lighting_system.hpp"
#include "gseurat/engine/systems/particle_system.hpp"
#include "gseurat/engine/systems/pbd_system.hpp"
#include "gseurat/engine/systems/transition_system.hpp"
#include "gseurat/engine/systems/vfx_system.hpp"
#include "gseurat/engine/weather_system.hpp"
#include "gseurat/engine/text_renderer.hpp"
#include "gseurat/engine/types.hpp"
#include "gseurat/engine/ui/ui_context.hpp"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <vector>

namespace gseurat {

struct DebugMetrics {
    float fps = 0.0f;
    float frame_times[300]{};
    int frame_time_idx = 0;
    int frame_count = 0;
    float timer = 0.0f;
    static constexpr float kUpdateInterval = 0.5f;

    void update(float dt) {
        frame_count++;
        timer += dt;
        if (timer >= kUpdateInterval) {
            fps = static_cast<float>(frame_count) / timer;
            frame_count = 0;
            timer = 0.0f;
        }
        frame_times[frame_time_idx] = dt * 1000.0f;
        frame_time_idx = (frame_time_idx + 1) % 300;
    }
};

class AppBase : public ITransitionHost {
public:
    virtual ~AppBase() = default;

    virtual void run();

    // Subsystem accessors (used by GameStates)
    InputManager& input() { return input_; }
    Renderer& renderer() { return renderer_; }
    // Phase 4c-vfx-2: VFX state ownership lives here, not on Renderer.
    // Pointer (not reference) because init_game_object_system() builds
    // it later than this accessor's first plausible use site.
    systems::VfxSystem* vfx_system() { return vfx_system_.get(); }
    const systems::VfxSystem* vfx_system() const { return vfx_system_.get(); }
    // Phase 4c-pbd: PBD splat state ownership lives here too. Same
    // late-construction caveat — null until init_game_object_system runs.
    systems::PbdSystem* pbd_system() { return pbd_system_.get(); }
    const systems::PbdSystem* pbd_system() const { return pbd_system_.get(); }
    // Phase 4d-2: static lights + static+VFX merge ownership.
    systems::LightingSystem* lighting_system() { return lighting_system_.get(); }
    const systems::LightingSystem* lighting_system() const { return lighting_system_.get(); }
    // Phase 4e: particle emitter ownership + per-frame compose.
    systems::ParticleSystem* particle_system() { return particle_system_.get(); }
    const systems::ParticleSystem* particle_system() const { return particle_system_.get(); }
    ResourceManager& resources() { return resources_; }
    Scene& scene() { return scene_; }
    ecs::World& world() { return world_; }
    audio::AudioEngine* audio() { return audio_engine_.get(); }
    SaveSystem& save_system() { return save_system_; }
    ParticleSystem& particles() { return particles_; }
    LocaleManager& locale() { return locale_; }
    FontAtlas& font_atlas() { return font_atlas_; }
    TextRenderer& text_renderer() { return text_renderer_; }
    ui::UIContext& ui_ctx() { return ui_ctx_; }
    GameStateStack& state_stack() { return state_stack_; }
    GLFWwindow* window() { return window_; }

    // ECS entity accessors
    ecs::Entity player_id() const { return player_id_; }
    const std::vector<ecs::Entity>& npc_ids() const { return npc_ids_; }

    // State object accessors
    GsTerrainState& gs_terrain() { return gs_terrain_; }
    const GsTerrainState& gs_terrain() const { return gs_terrain_; }
    SceneObjectState& scene_objects() { return scene_objects_; }
    const SceneObjectState& scene_objects() const { return scene_objects_; }
    DrawLists& draw_lists() { return draw_lists_; }
    const DrawLists& draw_lists() const { return draw_lists_; }
    BoneAnimationRegistry& bone_animation_registry() { return bone_anim_registry_; }
    [[nodiscard]] const BoneAnimationRegistry& bone_animation_registry() const { return bone_anim_registry_; }
    GameplayState& gameplay() { return gameplay_; }
    const GameplayState& gameplay() const { return gameplay_; }

    // Save/load helpers (virtual — game overrides)
    virtual SaveData build_save_data() const;
    virtual void apply_save_data(const SaveData& data);

    // Public methods used by states (virtual — game overrides).
    // init_scene/clear_scene are NOT part of ITransitionHost — they're generic
    // scene-management hooks called by both initial loads AND state.
    virtual void init_scene(const std::string& scene_path);
    virtual void clear_scene();

    // Hook invoked once per frame while `loading_monitor_.should_overlay_loading_ui()`
    // is true (Loading or Warming). Default impl is empty so the engine ships
    // no visual style — host applications override to draw their own overlay
    // (background, progress bar, art, etc.). Engine code stays free of
    // game-specific aesthetics per CLAUDE.md.
    virtual void draw_loading_overlay(float /*dt*/) {}

    // ITransitionHost: invoked atomically by transition_system on scene transitions.
    // Default impl does clear + init_scene + move PlayerTag entity. Game apps may
    // override to inject app-specific scene-recovery work.
    void transition_scene(const std::string& target_scene,
                          const glm::vec3& target_position) override;

    // ITransitionHost: lets the transition system pin the SceneIn fade at
    // alpha=1.0 while async scene loading is in flight.
    bool is_async_loading() const override {
        return is_async_loading_gs_scene();
    }

    // Shared GS scene loading: PLY + placed objects + lights + emitters + animations + VFX
    void load_gs_scene(const SceneData& scene_data, const GsSceneOptions& opts = {});

    // Pre-parsed variant: caller has already run `GsSceneLoader::parse` (typically
    // on a worker thread to overlap PLY I/O with other on_enter setup). The
    // finalize phase still runs on the main thread inside this call — same GPU
    // sequencing as the synchronous `load_gs_scene`. Caller is responsible for
    // ensuring `parsed` was produced from the same `scene_data` passed here.
    void load_pre_parsed_gs_scene(const SceneData& scene_data,
                                  ParsedScene&& parsed,
                                  const GsSceneOptions& opts = {});

    // Async-load API. Pushes the CPU-only PLY parse + Gaussian merge to a worker
    // thread (`std::async(std::launch::async, …)`), returning immediately. The
    // main thread is expected to invoke `tick_async_load_gs_scene` once per
    // frame; once the parse future is ready, that hook performs the GPU/ECS
    // finalize phase synchronously and then arms `loading_monitor_` to track
    // the streaming-upload phase. While the parse is in flight,
    // `is_async_loading_gs_scene` returns true so callers can render a
    // loading overlay or otherwise gate input.
    void begin_async_load_gs_scene(SceneData scene_data,
                                   const GsSceneOptions& opts = {});
    void tick_async_load_gs_scene();
    bool is_async_loading_gs_scene() const {
        return pending_async_scene_.has_value();
    }

    virtual void update_game(float dt);
    void upload_bone_transforms();
    virtual void update_audio(float dt);

    // Step mode
    bool step_mode() const { return step_mode_; }
    uint64_t tick() const { return tick_; }

    // Torch emitters
    size_t (&torch_emitter_ids())[4] { return torch_emitter_ids_; }

    // Feature flags
    FeatureFlags& feature_flags() { return feature_flags_; }
    const FeatureFlags& feature_flags() const { return feature_flags_; }

    // Allow custom start state (e.g. DemoApp skips TitleState)
    void set_start_state(std::unique_ptr<GameState> state);

    // Weather system accessor
    WeatherSystem& weather_system() { return weather_system_; }

    // Day/night system accessor
    DayNightSystem& day_night_system() { return day_night_system_; }

    // Debug metrics accessor
    DebugMetrics& debug_metrics() { return debug_metrics_; }
    const DebugMetrics& debug_metrics() const { return debug_metrics_; }

    // Developer overlay accessor
    DevOverlay& dev_overlay() { return dev_overlay_; }
    const DevOverlay& dev_overlay() const { return dev_overlay_; }

    // Debug dump registry accessor
    DebugDumpRegistry& debug_dump_registry() { return debug_dump_registry_; }
    const DebugDumpRegistry& debug_dump_registry() const { return debug_dump_registry_; }

    // Bone pre-upload hook (e.g., terrain sway on bone 0)
    void set_bone_pre_upload_hook(std::function<void(BonesWriter&)> hook) {
        bone_pre_upload_hook_ = std::move(hook);
    }

    // Screen effects accessor
    ScreenEffects& screen_effects() { return screen_effects_; }

    // Async loading accessors
    AsyncLoader& async_loader() { return async_loader_; }
    StagingUploader& staging_uploader() { return staging_uploader_; }

    // Engine-level lifecycle monitor (Loading / Warming / Playing). Default
    // state is Playing; games opt into the loading flow by calling
    // `loading_monitor().begin_load(...)` after enqueueing async asset
    // uploads on a TransferQueue (or any other handle-producing loader).
    EngineLoadingMonitor& loading_monitor() { return loading_monitor_; }
    const EngineLoadingMonitor& loading_monitor() const { return loading_monitor_; }

    // Game object system accessors
    ComponentRegistry& component_registry() { return component_registry_; }
    SystemScheduler& system_scheduler() { return system_scheduler_; }

    // Command dispatch
    CommandDispatcher& command_dispatcher() { return command_dispatcher_; }

    // Pending character load (set by load_character command, consumed by StagingState)
    std::string pending_character_path;  // non-empty = load request pending

    // === RenderState contract (Phase 3b) ===
    // Constructed during main_loop() once VkContext is initialized; reset
    // in cleanup() before renderer_.shutdown() tears the context down.
    // Phase 4 PRs migrate producers/consumers onto this contract.
    RenderState& render_state() { return *render_state_; }
    const RenderState& render_state() const { return *render_state_; }
    bool has_render_state() const noexcept { return render_state_ != nullptr; }

    // Idempotent. Subclasses call this from init_game_content() right
    // after renderer_.init() so render_state_ is wired into gs_renderer
    // BEFORE any state push triggers init_streaming → update_descriptors.
    void init_render_state();

protected:
    void init_window();
    virtual void init_game_content();
    virtual void main_loop();
    virtual void cleanup();

    GLFWwindow* window_ = nullptr;
    ResourceManager resources_;
    Renderer renderer_;
    InputManager input_;
    Scene scene_;
    std::chrono::steady_clock::time_point last_update_time_;

    // Feature flags
    FeatureFlags feature_flags_;
    std::unique_ptr<GameState> custom_start_state_;

    // Game state stack
    GameStateStack state_stack_;

    // ECS
    ecs::World world_;
    ecs::Entity player_id_ = ecs::kNullEntity;
    std::vector<ecs::Entity> npc_ids_;

    // UI context
    ui::UIContext ui_ctx_;

    // i18n
    LocaleManager locale_;
    FontAtlas font_atlas_;
    TextRenderer text_renderer_;

    // State objects (replacing scattered members)
    GsTerrainState gs_terrain_;
    BoneAnimationRegistry bone_anim_registry_;
    SceneObjectState scene_objects_;
    DrawLists draw_lists_;
    GameplayState gameplay_;

    std::vector<PointLight> static_lights_;

    // Particles & Weather
    ParticleSystem particles_;
    size_t torch_emitter_ids_[4]{};
    WeatherSystem weather_system_;
    DayNightSystem day_night_system_;

    // Screen effects
    ScreenEffects screen_effects_;

    // Debug metrics
    DebugMetrics debug_metrics_;

    // RenderState — constructed lazily in AppBase::main_loop() after the
    // renderer (and thus VkContext) has been initialised by the subclass.
    // Held by unique_ptr so its destructor runs deterministically before
    // VkContext tear-down inside cleanup().
    std::unique_ptr<RenderState> render_state_;

    // VFX spawn consumer (Phase 4a). Owns the cursor so it doesn't
    // re-process events across frames. Registered with system_scheduler_
    // in init_game_object_system().
    std::unique_ptr<systems::VfxSystem> vfx_system_;

    // Phase 4c-pbd: PBD splat owner. Constructed alongside vfx_system_
    // in init_game_object_system; render_state binding late-binds the
    // same way as VfxSystem.
    std::unique_ptr<systems::PbdSystem> pbd_system_;

    // Phase 4d-2: Static lights + static+VFX merge owner. Same
    // late-construction shape as VFX/PBD.
    std::unique_ptr<systems::LightingSystem> lighting_system_;

    // Phase 4e: Particle emitters owner. Writes encoded GpuGaussians
    // into RenderState::particles_buffer per frame, consumed by
    // GsRenderer::dispatch_compose_particles.
    std::unique_ptr<systems::ParticleSystem> particle_system_;

    // Bone pre-upload hook (Phase 4b: writer API). Game-specific code
    // installs this to fill specific bone slots (e.g. the player's bones)
    // before gather_bone_animation_transforms walks the NPC registry.
    std::function<void(BonesWriter&)> bone_pre_upload_hook_;

    // Developer overlay
    DevOverlay dev_overlay_;

    // Debug dump registry (on-demand self-reporting)
    DebugDumpRegistry debug_dump_registry_;

    // Minimap
    Minimap minimap_;

    // Audio engine (interactive music — constructed in init_game_content)
    std::unique_ptr<audio::AudioEngine> audio_engine_;

    // Save system
    SaveSystem save_system_;

    // ── Command dispatch (C++23 Command Pattern) ──
    CommandContext build_command_context();
    CommandDispatcher command_dispatcher_{build_command_context()};
    void poll_control_server();

    // Control server (bridge integration — Unix socket or Windows Named Pipe)
    ControlServer control_server_;

    // Step mode / control. pending_steps_ is atomic so the field is safe if
    // socket I/O is ever moved off the main thread; std::memory_order_relaxed
    // is sufficient today since both reads and writes are single-threaded.
    bool step_mode_ = false;
    std::atomic<int> pending_steps_ = 0;
    // Synchronous "step N": captured at command time, response sent after
    // the Nth frame completes. reply_target = -1 means no step in flight.
    CommandContext::DeferredStepResponse deferred_step_response_;
    uint64_t tick_ = 0;
    static constexpr float kFixedDt = 1.0f / 60.0f;

    // Camera broadcast throttle
    float camera_broadcast_timer_ = 0.0f;
    static constexpr float kCameraBroadcastInterval = 1.0f / 30.0f;  // 30 Hz
    std::string screenshot_response_path_;

    // Async asset loading
    AsyncLoader async_loader_;
    StagingUploader staging_uploader_;

    // Engine-level Loading/Warming/Playing state machine.
    EngineLoadingMonitor loading_monitor_;

    // Game object system
    ComponentRegistry component_registry_;
    SystemScheduler system_scheduler_;
    void init_game_object_system();

    // In-flight async scene load. The future runs `GsSceneLoader::parse` on a
    // worker thread; the main thread polls it from `tick_async_load_gs_scene`
    // and, when it is ready, performs the Vulkan / ECS finalize phase on the
    // calling (main) thread. `scene_data` and `opts` are owned here so they
    // outlive the worker.
    struct PendingAsyncScene {
        std::future<ParsedScene> parse_future;
        SceneData scene_data;
        GsSceneOptions opts;
    };
    std::optional<PendingAsyncScene> pending_async_scene_;
};

}  // namespace gseurat
