#pragma once

#ifdef GSEURAT_DEV_MODE

namespace gseurat {

class AppBase;

// Built-in engine panels (registered by DevOverlay::init)
void draw_performance_panel(AppBase& app);
void draw_render_settings_panel(AppBase& app);
void draw_gs_params_panel(AppBase& app);
void draw_feature_toggles_panel(AppBase& app);
void draw_lighting_panel(AppBase& app);
void draw_camera_info_panel(AppBase& app);

}  // namespace gseurat

#endif  // GSEURAT_DEV_MODE
