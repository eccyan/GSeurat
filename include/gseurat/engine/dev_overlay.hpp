#pragma once

#include <string>

#ifdef GSEURAT_DEV_MODE
#include <imgui.h>
#include <vulkan/vulkan.h>
#include <functional>
#include <vector>
#endif

struct GLFWwindow;

namespace gseurat {

class AppBase;
class Renderer;

#ifdef GSEURAT_DEV_MODE

using PanelDrawFn = std::function<void(AppBase&)>;

class DevOverlay {
public:
    void init(GLFWwindow* window, Renderer& renderer);
    void shutdown(Renderer& renderer);

    void begin_frame();
    void end_frame();

    void toggle() { visible_ = !visible_; }
    bool visible() const { return visible_; }
    bool wants_mouse() const;
    bool wants_keyboard() const;

    void draw(AppBase& app);

    void register_panel(const std::string& name, PanelDrawFn fn, bool visible = true);

    // Gizmo visibility (read by app gizmo rendering code)
    bool show_gizmo_lights = true;
    bool show_gizmo_emitters = true;
    bool show_gizmo_vfx = true;
    bool show_gizmo_game_objects = true;
    bool show_gizmo_triggers = true;

private:
    struct PanelEntry {
        std::string name;
        PanelDrawFn draw_fn;
        bool visible = true;
    };

    bool visible_ = false;
    std::vector<PanelEntry> panels_;

    VkDescriptorPool imgui_pool_ = VK_NULL_HANDLE;
    VkRenderPass imgui_render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> imgui_framebuffers_;

    void create_render_pass(Renderer& renderer);
    void create_framebuffers(Renderer& renderer);
    void draw_menu_bar();
};

#else  // !GSEURAT_DEV_MODE — no-op stubs

class DevOverlay {
public:
    void init(GLFWwindow*, Renderer&) {}
    void shutdown(Renderer&) {}
    void begin_frame() {}
    void end_frame() {}
    void toggle() {}
    bool visible() const { return false; }
    bool wants_mouse() const { return false; }
    bool wants_keyboard() const { return false; }
    void draw(AppBase&) {}
    template<typename F>
    void register_panel(const std::string&, F&&, bool = true) {}
};

#endif

}  // namespace gseurat
