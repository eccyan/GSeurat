#pragma once

#include <vulkan/vulkan.h>

#include <string>
#include <vector>

namespace vulkan_game {

VkShaderModule load_shader_module(VkDevice device, const std::string& filepath);

class PipelineBuilder {
public:
    PipelineBuilder& set_shaders(VkShaderModule vert, VkShaderModule frag);
    PipelineBuilder& set_vertex_input(
        const VkVertexInputBindingDescription& binding,
        const VkVertexInputAttributeDescription* attributes, uint32_t attribute_count);
    PipelineBuilder& set_input_assembly(VkPrimitiveTopology topology);
    PipelineBuilder& set_viewport_scissor(VkExtent2D extent);
    PipelineBuilder& set_rasterizer(VkPolygonMode polygon_mode, VkCullModeFlagBits cull_mode);
    PipelineBuilder& set_multisampling(VkSampleCountFlagBits samples);
    PipelineBuilder& set_depth_stencil(bool depth_test, bool depth_write);
    PipelineBuilder& set_color_blend_alpha();
    PipelineBuilder& set_no_blend();
    PipelineBuilder& set_no_vertex_input();
    PipelineBuilder& set_dynamic_scissor();
    PipelineBuilder& set_layout(VkPipelineLayout layout);
    PipelineBuilder& set_render_pass(VkRenderPass render_pass, uint32_t subpass);

    VkPipeline build(VkDevice device);

private:
    std::vector<VkPipelineShaderStageCreateInfo> shader_stages_;
    VkPipelineVertexInputStateCreateInfo vertex_input_{};
    VkPipelineInputAssemblyStateCreateInfo input_assembly_{};
    VkViewport viewport_{};
    VkRect2D scissor_{};
    VkPipelineRasterizationStateCreateInfo rasterizer_{};
    VkPipelineMultisampleStateCreateInfo multisampling_{};
    VkPipelineDepthStencilStateCreateInfo depth_stencil_{};
    VkPipelineColorBlendAttachmentState color_blend_attachment_{};
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkRenderPass render_pass_ = VK_NULL_HANDLE;
    uint32_t subpass_ = 0;
    std::vector<VkDynamicState> dynamic_states_;
};

}  // namespace vulkan_game
