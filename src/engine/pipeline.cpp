#include "vulkan_game/engine/pipeline.hpp"

#include <fstream>
#include <stdexcept>

namespace vulkan_game {

VkShaderModule load_shader_module(VkDevice device, const std::string& filepath) {
    std::ifstream file(filepath, std::ios::ate | std::ios::binary);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open shader file: " + filepath);
    }

    auto size = static_cast<size_t>(file.tellg());
    std::vector<char> code(size);
    file.seekg(0);
    file.read(code.data(), static_cast<std::streamsize>(size));

    VkShaderModuleCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO;
    info.codeSize = size;
    info.pCode = reinterpret_cast<const uint32_t*>(code.data());

    VkShaderModule module;
    if (vkCreateShaderModule(device, &info, nullptr, &module) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create shader module");
    }
    return module;
}

PipelineBuilder& PipelineBuilder::set_shaders(VkShaderModule vert, VkShaderModule frag) {
    shader_stages_.clear();

    VkPipelineShaderStageCreateInfo vert_stage{};
    vert_stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    vert_stage.stage = VK_SHADER_STAGE_VERTEX_BIT;
    vert_stage.module = vert;
    vert_stage.pName = "main";
    shader_stages_.push_back(vert_stage);

    VkPipelineShaderStageCreateInfo frag_stage{};
    frag_stage.sType = VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO;
    frag_stage.stage = VK_SHADER_STAGE_FRAGMENT_BIT;
    frag_stage.module = frag;
    frag_stage.pName = "main";
    shader_stages_.push_back(frag_stage);

    return *this;
}

PipelineBuilder& PipelineBuilder::set_vertex_input(
    const VkVertexInputBindingDescription& binding,
    const VkVertexInputAttributeDescription* attributes, uint32_t attribute_count) {
    vertex_input_.sType = VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO;
    vertex_input_.vertexBindingDescriptionCount = 1;
    vertex_input_.pVertexBindingDescriptions = &binding;
    vertex_input_.vertexAttributeDescriptionCount = attribute_count;
    vertex_input_.pVertexAttributeDescriptions = attributes;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_input_assembly(VkPrimitiveTopology topology) {
    input_assembly_.sType = VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO;
    input_assembly_.topology = topology;
    input_assembly_.primitiveRestartEnable = VK_FALSE;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_viewport_scissor(VkExtent2D extent) {
    viewport_.x = 0.0f;
    viewport_.y = 0.0f;
    viewport_.width = static_cast<float>(extent.width);
    viewport_.height = static_cast<float>(extent.height);
    viewport_.minDepth = 0.0f;
    viewport_.maxDepth = 1.0f;

    scissor_.offset = {0, 0};
    scissor_.extent = extent;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_rasterizer(VkPolygonMode polygon_mode,
                                                  VkCullModeFlagBits cull_mode) {
    rasterizer_.sType = VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO;
    rasterizer_.polygonMode = polygon_mode;
    rasterizer_.lineWidth = 1.0f;
    rasterizer_.cullMode = cull_mode;
    rasterizer_.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_multisampling(VkSampleCountFlagBits samples) {
    multisampling_.sType = VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO;
    multisampling_.rasterizationSamples = samples;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_depth_stencil(bool depth_test, bool depth_write) {
    depth_stencil_.sType = VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO;
    depth_stencil_.depthTestEnable = depth_test ? VK_TRUE : VK_FALSE;
    depth_stencil_.depthWriteEnable = depth_write ? VK_TRUE : VK_FALSE;
    depth_stencil_.depthCompareOp = VK_COMPARE_OP_LESS;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_color_blend_alpha() {
    color_blend_attachment_.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT |
                                             VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
    color_blend_attachment_.blendEnable = VK_TRUE;
    color_blend_attachment_.srcColorBlendFactor = VK_BLEND_FACTOR_SRC_ALPHA;
    color_blend_attachment_.dstColorBlendFactor = VK_BLEND_FACTOR_ONE_MINUS_SRC_ALPHA;
    color_blend_attachment_.colorBlendOp = VK_BLEND_OP_ADD;
    color_blend_attachment_.srcAlphaBlendFactor = VK_BLEND_FACTOR_ONE;
    color_blend_attachment_.dstAlphaBlendFactor = VK_BLEND_FACTOR_ZERO;
    color_blend_attachment_.alphaBlendOp = VK_BLEND_OP_ADD;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_layout(VkPipelineLayout layout) {
    layout_ = layout;
    return *this;
}

PipelineBuilder& PipelineBuilder::set_render_pass(VkRenderPass render_pass, uint32_t subpass) {
    render_pass_ = render_pass;
    subpass_ = subpass;
    return *this;
}

VkPipeline PipelineBuilder::build(VkDevice device) {
    VkPipelineViewportStateCreateInfo viewport_state{};
    viewport_state.sType = VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO;
    viewport_state.viewportCount = 1;
    viewport_state.pViewports = &viewport_;
    viewport_state.scissorCount = 1;
    viewport_state.pScissors = &scissor_;

    VkPipelineColorBlendStateCreateInfo color_blend{};
    color_blend.sType = VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO;
    color_blend.attachmentCount = 1;
    color_blend.pAttachments = &color_blend_attachment_;

    VkGraphicsPipelineCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO;
    info.stageCount = static_cast<uint32_t>(shader_stages_.size());
    info.pStages = shader_stages_.data();
    info.pVertexInputState = &vertex_input_;
    info.pInputAssemblyState = &input_assembly_;
    info.pViewportState = &viewport_state;
    info.pRasterizationState = &rasterizer_;
    info.pMultisampleState = &multisampling_;
    info.pDepthStencilState = &depth_stencil_;
    info.pColorBlendState = &color_blend;
    info.layout = layout_;
    info.renderPass = render_pass_;
    info.subpass = subpass_;

    VkPipeline pipeline;
    if (vkCreateGraphicsPipelines(device, VK_NULL_HANDLE, 1, &info, nullptr, &pipeline) !=
        VK_SUCCESS) {
        throw std::runtime_error("Failed to create graphics pipeline");
    }
    return pipeline;
}

}  // namespace vulkan_game
