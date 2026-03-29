#pragma once

#include "gseurat/engine/app_base.hpp"

#include <vulkan/vulkan.h>
#include <string>

namespace gseurat {

class StagingApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);

protected:
    void init_game_content() override;
    void main_loop() override;
    void cleanup() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;

private:
    void init_imgui();
    void shutdown_imgui();
    void create_imgui_render_pass();

    std::string scene_path_ = "assets/scenes/gs_demo.json";

    // ImGui Vulkan resources
    VkDescriptorPool imgui_pool_ = VK_NULL_HANDLE;
    VkRenderPass imgui_render_pass_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> imgui_framebuffers_;
};

}  // namespace gseurat
