#include "gseurat/engine/post_process.hpp"
#include "gseurat/engine/pipeline.hpp"
#include "gseurat/engine/swapchain.hpp"

#include <array>
#include <cstring>
#include <stdexcept>

namespace gseurat {

void PostProcessPipeline::init(VkDevice device, VmaAllocator allocator,
                                const Swapchain& swapchain) {
    device_ = device;
    scene_width_ = swapchain.extent().width;
    scene_height_ = swapchain.extent().height;
    bloom_width_ = scene_width_ / 4;
    bloom_height_ = scene_height_ / 4;
    dof_width_ = scene_width_ / 2;
    dof_height_ = scene_height_ / 2;

    create_images(device, allocator, swapchain.extent());
    create_sampler(device);
    create_render_passes(device, swapchain.image_format());
    create_framebuffers(device, swapchain);
    create_descriptor_resources(device);
    create_pipelines(device);

    // Create light glow UBO (host-visible for easy update)
    {
        VkBufferCreateInfo buf_info{};
        buf_info.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        buf_info.size = sizeof(LightGlowData);
        buf_info.usage = VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT;

        VmaAllocationCreateInfo alloc_info{};
        alloc_info.usage = VMA_MEMORY_USAGE_CPU_TO_GPU;
        alloc_info.flags = VMA_ALLOCATION_CREATE_MAPPED_BIT;

        if (vmaCreateBuffer(allocator, &buf_info, &alloc_info,
                            &light_glow_buffer_, &light_glow_alloc_, nullptr) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create light glow UBO");
        }

        // Zero-init (no lights by default)
        LightGlowData zero{};
        void* mapped = nullptr;
        vmaMapMemory(allocator, light_glow_alloc_, &mapped);
        std::memcpy(mapped, &zero, sizeof(zero));
        vmaUnmapMemory(allocator, light_glow_alloc_);

        // Write UBO descriptor for composite set binding 4
        VkDescriptorBufferInfo buf_desc{};
        buf_desc.buffer = light_glow_buffer_;
        buf_desc.offset = 0;
        buf_desc.range = sizeof(LightGlowData);

        VkWriteDescriptorSet ubo_write{};
        ubo_write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
        ubo_write.dstSet = ds_composite_;
        ubo_write.dstBinding = 4;
        ubo_write.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        ubo_write.descriptorCount = 1;
        ubo_write.pBufferInfo = &buf_desc;

        vkUpdateDescriptorSets(device, 1, &ubo_write, 0, nullptr);
    }
}

void PostProcessPipeline::shutdown(VkDevice device, VmaAllocator allocator) {
    if (light_glow_buffer_) {
        vmaDestroyBuffer(allocator, light_glow_buffer_, light_glow_alloc_);
    }

    vkDestroyPipeline(device, composite_pipeline_, nullptr);
    vkDestroyPipeline(device, dof_blur_pipeline_, nullptr);
    vkDestroyPipeline(device, bloom_blur_pipeline_, nullptr);
    vkDestroyPipeline(device, bloom_extract_pipeline_, nullptr);
    vkDestroyPipelineLayout(device, composite_pipeline_layout_, nullptr);
    vkDestroyPipelineLayout(device, bloom_pipeline_layout_, nullptr);

    vkDestroyDescriptorPool(device, pp_pool_, nullptr);
    vkDestroyDescriptorSetLayout(device, composite_layout_, nullptr);
    vkDestroyDescriptorSetLayout(device, pp_layout_, nullptr);

    for (auto fb : composite_framebuffers_) {
        vkDestroyFramebuffer(device, fb, nullptr);
    }
    vkDestroyFramebuffer(device, dof_b_framebuffer_, nullptr);
    vkDestroyFramebuffer(device, dof_a_framebuffer_, nullptr);
    vkDestroyFramebuffer(device, bloom_b_framebuffer_, nullptr);
    vkDestroyFramebuffer(device, bloom_a_framebuffer_, nullptr);
    vkDestroyFramebuffer(device, scene_framebuffer_, nullptr);

    vkDestroyRenderPass(device, composite_render_pass_, nullptr);
    vkDestroyRenderPass(device, bloom_render_pass_, nullptr);
    vkDestroyRenderPass(device, scene_render_pass_, nullptr);

    vkDestroySampler(device, nearest_sampler_, nullptr);
    vkDestroySampler(device, linear_sampler_, nullptr);

    destroy_image(device, allocator, dof_b_);
    destroy_image(device, allocator, dof_a_);
    destroy_image(device, allocator, bloom_b_);
    destroy_image(device, allocator, bloom_a_);
    destroy_image(device, allocator, offscreen_depth_);
    destroy_image(device, allocator, offscreen_color_);
}

PostProcessPipeline::ImageResource PostProcessPipeline::create_color_image(
    VkDevice device, VmaAllocator allocator, VkFormat format,
    uint32_t width, uint32_t height, VkImageUsageFlags usage) {
    ImageResource res{};

    VkImageCreateInfo image_info{};
    image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
    image_info.imageType = VK_IMAGE_TYPE_2D;
    image_info.format = format;
    image_info.extent = {width, height, 1};
    image_info.mipLevels = 1;
    image_info.arrayLayers = 1;
    image_info.samples = VK_SAMPLE_COUNT_1_BIT;
    image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
    image_info.usage = usage;

    VmaAllocationCreateInfo alloc_info{};
    alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

    if (vmaCreateImage(allocator, &image_info, &alloc_info,
                       &res.image, &res.allocation, nullptr) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create post-process image");
    }

    VkImageViewCreateInfo view_info{};
    view_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
    view_info.image = res.image;
    view_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
    view_info.format = format;
    view_info.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
    view_info.subresourceRange.levelCount = 1;
    view_info.subresourceRange.layerCount = 1;

    if (vkCreateImageView(device, &view_info, nullptr, &res.view) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create post-process image view");
    }

    return res;
}

void PostProcessPipeline::destroy_image(VkDevice device, VmaAllocator allocator,
                                         ImageResource& img) {
    if (img.view) vkDestroyImageView(device, img.view, nullptr);
    if (img.image) vmaDestroyImage(allocator, img.image, img.allocation);
    img = {};
}

void PostProcessPipeline::create_images(VkDevice device, VmaAllocator allocator,
                                         VkExtent2D scene_extent) {
    // Offscreen HDR color target
    offscreen_color_ = create_color_image(
        device, allocator, VK_FORMAT_R16G16B16A16_SFLOAT,
        scene_extent.width, scene_extent.height,
        VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT);

    // Offscreen depth
    {
        VkImageCreateInfo image_info{};
        image_info.sType = VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO;
        image_info.imageType = VK_IMAGE_TYPE_2D;
        image_info.format = VK_FORMAT_D32_SFLOAT;
        image_info.extent = {scene_extent.width, scene_extent.height, 1};
        image_info.mipLevels = 1;
        image_info.arrayLayers = 1;
        image_info.samples = VK_SAMPLE_COUNT_1_BIT;
        image_info.tiling = VK_IMAGE_TILING_OPTIMAL;
        image_info.usage = VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT |
                           VK_IMAGE_USAGE_SAMPLED_BIT;

        VmaAllocationCreateInfo alloc_info{};
        alloc_info.usage = VMA_MEMORY_USAGE_GPU_ONLY;

        if (vmaCreateImage(allocator, &image_info, &alloc_info,
                           &offscreen_depth_.image, &offscreen_depth_.allocation, nullptr) !=
            VK_SUCCESS) {
            throw std::runtime_error("Failed to create offscreen depth image");
        }

        VkImageViewCreateInfo view_info{};
        view_info.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        view_info.image = offscreen_depth_.image;
        view_info.viewType = VK_IMAGE_VIEW_TYPE_2D;
        view_info.format = VK_FORMAT_D32_SFLOAT;
        view_info.subresourceRange.aspectMask = VK_IMAGE_ASPECT_DEPTH_BIT;
        view_info.subresourceRange.levelCount = 1;
        view_info.subresourceRange.layerCount = 1;

        if (vkCreateImageView(device, &view_info, nullptr, &offscreen_depth_.view) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create offscreen depth image view");
        }
    }

    // Bloom quarter-res ping-pong buffers
    bloom_a_ = create_color_image(
        device, allocator, VK_FORMAT_R16G16B16A16_SFLOAT,
        bloom_width_, bloom_height_,
        VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT);

    bloom_b_ = create_color_image(
        device, allocator, VK_FORMAT_R16G16B16A16_SFLOAT,
        bloom_width_, bloom_height_,
        VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT);

    // DoF half-res ping-pong buffers
    dof_a_ = create_color_image(
        device, allocator, VK_FORMAT_R16G16B16A16_SFLOAT,
        dof_width_, dof_height_,
        VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT);

    dof_b_ = create_color_image(
        device, allocator, VK_FORMAT_R16G16B16A16_SFLOAT,
        dof_width_, dof_height_,
        VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | VK_IMAGE_USAGE_SAMPLED_BIT);
}

void PostProcessPipeline::create_sampler(VkDevice device) {
    VkSamplerCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    info.magFilter = VK_FILTER_LINEAR;
    info.minFilter = VK_FILTER_LINEAR;
    info.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    info.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    info.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;

    if (vkCreateSampler(device, &info, nullptr, &linear_sampler_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create post-process sampler");
    }

    // Nearest sampler for depth (avoids interpolation artifacts)
    VkSamplerCreateInfo nearest_info{};
    nearest_info.sType = VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO;
    nearest_info.magFilter = VK_FILTER_NEAREST;
    nearest_info.minFilter = VK_FILTER_NEAREST;
    nearest_info.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    nearest_info.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
    nearest_info.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;

    if (vkCreateSampler(device, &nearest_info, nullptr, &nearest_sampler_) != VK_SUCCESS) {
        throw std::runtime_error("Failed to create nearest sampler");
    }
}

void PostProcessPipeline::create_render_passes(VkDevice device, VkFormat swapchain_format) {
    // Scene render pass: RGBA16F color + D32 depth
    {
        VkAttachmentDescription color_att{};
        color_att.format = VK_FORMAT_R16G16B16A16_SFLOAT;
        color_att.samples = VK_SAMPLE_COUNT_1_BIT;
        color_att.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        color_att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        color_att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color_att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        color_att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        color_att.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkAttachmentDescription depth_att{};
        depth_att.format = VK_FORMAT_D32_SFLOAT;
        depth_att.samples = VK_SAMPLE_COUNT_1_BIT;
        depth_att.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
        depth_att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        depth_att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        depth_att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        depth_att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        depth_att.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkAttachmentReference color_ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
        VkAttachmentReference depth_ref{1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};

        VkSubpassDescription subpass{};
        subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        subpass.colorAttachmentCount = 1;
        subpass.pColorAttachments = &color_ref;
        subpass.pDepthStencilAttachment = &depth_ref;

        VkSubpassDependency dep{};
        dep.srcSubpass = VK_SUBPASS_EXTERNAL;
        dep.dstSubpass = 0;
        dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                           VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        dep.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT |
                           VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
        dep.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT |
                            VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;

        std::array<VkAttachmentDescription, 2> attachments = {color_att, depth_att};

        VkRenderPassCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        info.attachmentCount = static_cast<uint32_t>(attachments.size());
        info.pAttachments = attachments.data();
        info.subpassCount = 1;
        info.pSubpasses = &subpass;
        info.dependencyCount = 1;
        info.pDependencies = &dep;

        if (vkCreateRenderPass(device, &info, nullptr, &scene_render_pass_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create scene render pass");
        }
    }

    // Bloom render pass: RGBA16F color only (reused for extract + blur passes)
    {
        VkAttachmentDescription color_att{};
        color_att.format = VK_FORMAT_R16G16B16A16_SFLOAT;
        color_att.samples = VK_SAMPLE_COUNT_1_BIT;
        color_att.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color_att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        color_att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color_att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        color_att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        color_att.finalLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkAttachmentReference color_ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};

        VkSubpassDescription subpass{};
        subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        subpass.colorAttachmentCount = 1;
        subpass.pColorAttachments = &color_ref;

        // Ensure previous writes complete before reading as sampled image
        VkSubpassDependency dep{};
        dep.srcSubpass = VK_SUBPASS_EXTERNAL;
        dep.dstSubpass = 0;
        dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dep.dstStageMask = VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT;
        dep.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
        dep.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;

        VkRenderPassCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        info.attachmentCount = 1;
        info.pAttachments = &color_att;
        info.subpassCount = 1;
        info.pSubpasses = &subpass;
        info.dependencyCount = 1;
        info.pDependencies = &dep;

        if (vkCreateRenderPass(device, &info, nullptr, &bloom_render_pass_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create bloom render pass");
        }
    }

    // Composite render pass: swapchain format color, UI draws here too
    {
        VkAttachmentDescription color_att{};
        color_att.format = swapchain_format;
        color_att.samples = VK_SAMPLE_COUNT_1_BIT;
        color_att.loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color_att.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
        color_att.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
        color_att.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
        color_att.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
        color_att.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

        VkAttachmentReference color_ref{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};

        VkSubpassDescription subpass{};
        subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
        subpass.colorAttachmentCount = 1;
        subpass.pColorAttachments = &color_ref;

        VkSubpassDependency dep{};
        dep.srcSubpass = VK_SUBPASS_EXTERNAL;
        dep.dstSubpass = 0;
        dep.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dep.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
        dep.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

        VkRenderPassCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
        info.attachmentCount = 1;
        info.pAttachments = &color_att;
        info.subpassCount = 1;
        info.pSubpasses = &subpass;
        info.dependencyCount = 1;
        info.pDependencies = &dep;

        if (vkCreateRenderPass(device, &info, nullptr, &composite_render_pass_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create composite render pass");
        }
    }
}

void PostProcessPipeline::create_framebuffers(VkDevice device, const Swapchain& swapchain) {
    // Scene framebuffer: offscreen color + depth
    {
        std::array<VkImageView, 2> attachments = {offscreen_color_.view, offscreen_depth_.view};

        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = scene_render_pass_;
        info.attachmentCount = static_cast<uint32_t>(attachments.size());
        info.pAttachments = attachments.data();
        info.width = scene_width_;
        info.height = scene_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &scene_framebuffer_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create scene framebuffer");
        }
    }

    // Bloom A framebuffer
    {
        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = bloom_render_pass_;
        info.attachmentCount = 1;
        info.pAttachments = &bloom_a_.view;
        info.width = bloom_width_;
        info.height = bloom_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &bloom_a_framebuffer_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create bloom A framebuffer");
        }
    }

    // Bloom B framebuffer
    {
        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = bloom_render_pass_;
        info.attachmentCount = 1;
        info.pAttachments = &bloom_b_.view;
        info.width = bloom_width_;
        info.height = bloom_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &bloom_b_framebuffer_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create bloom B framebuffer");
        }
    }

    // DoF A framebuffer (half resolution)
    {
        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = bloom_render_pass_;
        info.attachmentCount = 1;
        info.pAttachments = &dof_a_.view;
        info.width = dof_width_;
        info.height = dof_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &dof_a_framebuffer_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create DoF A framebuffer");
        }
    }

    // DoF B framebuffer (half resolution)
    {
        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = bloom_render_pass_;
        info.attachmentCount = 1;
        info.pAttachments = &dof_b_.view;
        info.width = dof_width_;
        info.height = dof_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &dof_b_framebuffer_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create DoF B framebuffer");
        }
    }

    // Composite framebuffers (one per swapchain image)
    composite_framebuffers_.resize(swapchain.image_count());
    for (uint32_t i = 0; i < swapchain.image_count(); i++) {
        VkImageView attachment = swapchain.image_views()[i];

        VkFramebufferCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
        info.renderPass = composite_render_pass_;
        info.attachmentCount = 1;
        info.pAttachments = &attachment;
        info.width = scene_width_;
        info.height = scene_height_;
        info.layers = 1;

        if (vkCreateFramebuffer(device, &info, nullptr, &composite_framebuffers_[i]) !=
            VK_SUCCESS) {
            throw std::runtime_error("Failed to create composite framebuffer");
        }
    }
}

void PostProcessPipeline::create_descriptor_resources(VkDevice device) {
    // Layout for single sampler (bloom passes)
    {
        VkDescriptorSetLayoutBinding binding{};
        binding.binding = 0;
        binding.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        binding.descriptorCount = 1;
        binding.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

        VkDescriptorSetLayoutCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        info.bindingCount = 1;
        info.pBindings = &binding;

        if (vkCreateDescriptorSetLayout(device, &info, nullptr, &pp_layout_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create pp descriptor set layout");
        }
    }

    // Layout for composite (4 samplers + 1 UBO for light glow)
    {
        std::array<VkDescriptorSetLayoutBinding, 5> bindings{};
        for (uint32_t i = 0; i < 4; i++) {
            bindings[i].binding = i;
            bindings[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            bindings[i].descriptorCount = 1;
            bindings[i].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        }
        // binding 4: light glow UBO
        bindings[4].binding = 4;
        bindings[4].descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        bindings[4].descriptorCount = 1;
        bindings[4].stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;

        VkDescriptorSetLayoutCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO;
        info.bindingCount = static_cast<uint32_t>(bindings.size());
        info.pBindings = bindings.data();

        if (vkCreateDescriptorSetLayout(device, &info, nullptr, &composite_layout_) !=
            VK_SUCCESS) {
            throw std::runtime_error("Failed to create composite descriptor set layout");
        }
    }

    // Descriptor pool: 6 sets total, 10 combined image samplers + 1 uniform buffer
    {
        std::array<VkDescriptorPoolSize, 2> pool_sizes{};
        pool_sizes[0].type = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
        pool_sizes[0].descriptorCount = 10;
        pool_sizes[1].type = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER;
        pool_sizes[1].descriptorCount = 1;

        VkDescriptorPoolCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
        info.poolSizeCount = static_cast<uint32_t>(pool_sizes.size());
        info.pPoolSizes = pool_sizes.data();
        info.maxSets = 6;

        if (vkCreateDescriptorPool(device, &info, nullptr, &pp_pool_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to create pp descriptor pool");
        }
    }

    // Allocate descriptor sets
    {
        // 4 single-sampler sets (offscreen, bloom_a, bloom_b, dof_a)
        std::array<VkDescriptorSetLayout, 4> pp_layouts = {
            pp_layout_, pp_layout_, pp_layout_, pp_layout_};
        VkDescriptorSetAllocateInfo alloc_info{};
        alloc_info.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        alloc_info.descriptorPool = pp_pool_;
        alloc_info.descriptorSetCount = 4;
        alloc_info.pSetLayouts = pp_layouts.data();

        std::array<VkDescriptorSet, 4> pp_sets;
        if (vkAllocateDescriptorSets(device, &alloc_info, pp_sets.data()) != VK_SUCCESS) {
            throw std::runtime_error("Failed to allocate pp descriptor sets");
        }
        ds_offscreen_ = pp_sets[0];
        ds_bloom_a_ = pp_sets[1];
        ds_bloom_b_ = pp_sets[2];
        ds_dof_a_ = pp_sets[3];

        // 1 composite set (4 samplers)
        VkDescriptorSetAllocateInfo comp_alloc{};
        comp_alloc.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
        comp_alloc.descriptorPool = pp_pool_;
        comp_alloc.descriptorSetCount = 1;
        comp_alloc.pSetLayouts = &composite_layout_;

        if (vkAllocateDescriptorSets(device, &comp_alloc, &ds_composite_) != VK_SUCCESS) {
            throw std::runtime_error("Failed to allocate composite descriptor set");
        }
    }

    // Write descriptor sets
    {
        auto write_single = [&](VkDescriptorSet set, VkImageView view) {
            VkDescriptorImageInfo img_info{};
            img_info.sampler = linear_sampler_;
            img_info.imageView = view;
            img_info.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

            VkWriteDescriptorSet write{};
            write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            write.dstSet = set;
            write.dstBinding = 0;
            write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            write.descriptorCount = 1;
            write.pImageInfo = &img_info;

            vkUpdateDescriptorSets(device, 1, &write, 0, nullptr);
        };

        write_single(ds_offscreen_, offscreen_color_.view);
        write_single(ds_bloom_a_, bloom_a_.view);
        write_single(ds_bloom_b_, bloom_b_.view);
        write_single(ds_dof_a_, dof_a_.view);

        // Composite: binding 0 = scene, binding 1 = bloom, binding 2 = dof, binding 3 = depth
        VkDescriptorImageInfo scene_img{};
        scene_img.sampler = linear_sampler_;
        scene_img.imageView = offscreen_color_.view;
        scene_img.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkDescriptorImageInfo bloom_img{};
        bloom_img.sampler = linear_sampler_;
        bloom_img.imageView = bloom_a_.view;
        bloom_img.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkDescriptorImageInfo dof_img{};
        dof_img.sampler = linear_sampler_;
        dof_img.imageView = dof_b_.view;
        dof_img.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        VkDescriptorImageInfo depth_img{};
        depth_img.sampler = nearest_sampler_;
        depth_img.imageView = offscreen_depth_.view;
        depth_img.imageLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;

        std::array<VkWriteDescriptorSet, 4> writes{};
        for (uint32_t i = 0; i < 4; i++) {
            writes[i].sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
            writes[i].dstSet = ds_composite_;
            writes[i].dstBinding = i;
            writes[i].descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
            writes[i].descriptorCount = 1;
        }
        writes[0].pImageInfo = &scene_img;
        writes[1].pImageInfo = &bloom_img;
        writes[2].pImageInfo = &dof_img;
        writes[3].pImageInfo = &depth_img;

        vkUpdateDescriptorSets(device, static_cast<uint32_t>(writes.size()),
                               writes.data(), 0, nullptr);

        // binding 4: light glow UBO (written later when buffer is created)
    }
}

void PostProcessPipeline::create_pipelines(VkDevice device) {
    auto fullscreen_vert = load_shader_module(device, "shaders/fullscreen.vert.spv");
    auto bloom_extract_frag = load_shader_module(device, "shaders/bloom_extract.frag.spv");
    auto bloom_blur_frag = load_shader_module(device, "shaders/bloom_blur.frag.spv");
    auto composite_frag = load_shader_module(device, "shaders/composite.frag.spv");

    // Bloom pipeline layout: pp_layout_ + 16B push constant
    {
        VkPushConstantRange push{};
        push.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        push.offset = 0;
        push.size = 16;  // 4 floats

        VkPipelineLayoutCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        info.setLayoutCount = 1;
        info.pSetLayouts = &pp_layout_;
        info.pushConstantRangeCount = 1;
        info.pPushConstantRanges = &push;

        if (vkCreatePipelineLayout(device, &info, nullptr, &bloom_pipeline_layout_) !=
            VK_SUCCESS) {
            throw std::runtime_error("Failed to create bloom pipeline layout");
        }
    }

    // Composite pipeline layout: composite_layout_ + 80B push constant
    {
        VkPushConstantRange push{};
        push.stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT;
        push.offset = 0;
        push.size = 80;  // 5 × vec4 (bloom, dof, depth, fog, screen_effects)

        VkPipelineLayoutCreateInfo info{};
        info.sType = VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO;
        info.setLayoutCount = 1;
        info.pSetLayouts = &composite_layout_;
        info.pushConstantRangeCount = 1;
        info.pPushConstantRanges = &push;

        if (vkCreatePipelineLayout(device, &info, nullptr, &composite_pipeline_layout_) !=
            VK_SUCCESS) {
            throw std::runtime_error("Failed to create composite pipeline layout");
        }
    }

    VkExtent2D bloom_extent{bloom_width_, bloom_height_};
    VkExtent2D scene_extent{scene_width_, scene_height_};

    // Bloom extract pipeline
    bloom_extract_pipeline_ = PipelineBuilder()
        .set_shaders(fullscreen_vert, bloom_extract_frag)
        .set_no_vertex_input()
        .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
        .set_viewport_scissor(bloom_extent)
        .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE)
        .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
        .set_depth_stencil(false, false)
        .set_no_blend()
        .set_layout(bloom_pipeline_layout_)
        .set_render_pass(bloom_render_pass_, 0)
        .build(device);

    // Bloom blur pipeline (same for H and V, direction via push constant)
    bloom_blur_pipeline_ = PipelineBuilder()
        .set_shaders(fullscreen_vert, bloom_blur_frag)
        .set_no_vertex_input()
        .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
        .set_viewport_scissor(bloom_extent)
        .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE)
        .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
        .set_depth_stencil(false, false)
        .set_no_blend()
        .set_layout(bloom_pipeline_layout_)
        .set_render_pass(bloom_render_pass_, 0)
        .build(device);

    // DoF blur pipeline (half resolution, reuses bloom_blur.frag)
    VkExtent2D dof_extent{dof_width_, dof_height_};
    dof_blur_pipeline_ = PipelineBuilder()
        .set_shaders(fullscreen_vert, bloom_blur_frag)
        .set_no_vertex_input()
        .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
        .set_viewport_scissor(dof_extent)
        .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE)
        .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
        .set_depth_stencil(false, false)
        .set_no_blend()
        .set_layout(bloom_pipeline_layout_)
        .set_render_pass(bloom_render_pass_, 0)
        .build(device);

    // Composite pipeline
    composite_pipeline_ = PipelineBuilder()
        .set_shaders(fullscreen_vert, composite_frag)
        .set_no_vertex_input()
        .set_input_assembly(VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST)
        .set_viewport_scissor(scene_extent)
        .set_rasterizer(VK_POLYGON_MODE_FILL, VK_CULL_MODE_NONE)
        .set_multisampling(VK_SAMPLE_COUNT_1_BIT)
        .set_depth_stencil(false, false)
        .set_no_blend()
        .set_layout(composite_pipeline_layout_)
        .set_render_pass(composite_render_pass_, 0)
        .build(device);

    vkDestroyShaderModule(device, composite_frag, nullptr);
    vkDestroyShaderModule(device, bloom_blur_frag, nullptr);
    vkDestroyShaderModule(device, bloom_extract_frag, nullptr);
    vkDestroyShaderModule(device, fullscreen_vert, nullptr);
}

void PostProcessPipeline::record_post_process(VkCommandBuffer cmd, uint32_t swapchain_index,
                                               const PostProcessParams& params) {
    float bloom_texel[2] = {1.0f / static_cast<float>(bloom_width_),
                            1.0f / static_cast<float>(bloom_height_)};
    float scene_texel[2] = {1.0f / static_cast<float>(scene_width_),
                            1.0f / static_cast<float>(scene_height_)};

    // --- Bloom Extract: offscreen → bloom_a ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = bloom_render_pass_;
        rp_info.framebuffer = bloom_a_framebuffer_;
        rp_info.renderArea.extent = {bloom_width_, bloom_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_extract_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_pipeline_layout_,
                                0, 1, &ds_offscreen_, 0, nullptr);

        struct { float threshold; float soft_knee; float texel_x; float texel_y; } extract_pc;
        extract_pc.threshold = params.bloom_threshold;
        extract_pc.soft_knee = params.bloom_soft_knee;
        extract_pc.texel_x = scene_texel[0];
        extract_pc.texel_y = scene_texel[1];
        vkCmdPushConstants(cmd, bloom_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 16, &extract_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        vkCmdEndRenderPass(cmd);
    }

    // --- Bloom H-Blur: bloom_a → bloom_b ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = bloom_render_pass_;
        rp_info.framebuffer = bloom_b_framebuffer_;
        rp_info.renderArea.extent = {bloom_width_, bloom_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_blur_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_pipeline_layout_,
                                0, 1, &ds_bloom_a_, 0, nullptr);

        struct { float dir_x; float dir_y; float texel_x; float texel_y; } blur_pc;
        blur_pc.dir_x = 1.0f;
        blur_pc.dir_y = 0.0f;
        blur_pc.texel_x = bloom_texel[0];
        blur_pc.texel_y = bloom_texel[1];
        vkCmdPushConstants(cmd, bloom_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 16, &blur_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        vkCmdEndRenderPass(cmd);
    }

    // --- Bloom V-Blur: bloom_b → bloom_a ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = bloom_render_pass_;
        rp_info.framebuffer = bloom_a_framebuffer_;
        rp_info.renderArea.extent = {bloom_width_, bloom_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_blur_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_pipeline_layout_,
                                0, 1, &ds_bloom_b_, 0, nullptr);

        struct { float dir_x; float dir_y; float texel_x; float texel_y; } blur_pc;
        blur_pc.dir_x = 0.0f;
        blur_pc.dir_y = 1.0f;
        blur_pc.texel_x = bloom_texel[0];
        blur_pc.texel_y = bloom_texel[1];
        vkCmdPushConstants(cmd, bloom_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 16, &blur_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        vkCmdEndRenderPass(cmd);
    }

    float dof_texel[2] = {1.0f / static_cast<float>(dof_width_),
                           1.0f / static_cast<float>(dof_height_)};

    // --- DoF H-Blur: offscreen → dof_a (half resolution) ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = bloom_render_pass_;
        rp_info.framebuffer = dof_a_framebuffer_;
        rp_info.renderArea.extent = {dof_width_, dof_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, dof_blur_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_pipeline_layout_,
                                0, 1, &ds_offscreen_, 0, nullptr);

        struct { float dir_x; float dir_y; float texel_x; float texel_y; } dof_h_pc;
        dof_h_pc.dir_x = 1.0f;
        dof_h_pc.dir_y = 0.0f;
        dof_h_pc.texel_x = dof_texel[0];
        dof_h_pc.texel_y = dof_texel[1];
        vkCmdPushConstants(cmd, bloom_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 16, &dof_h_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        vkCmdEndRenderPass(cmd);
    }

    // --- DoF V-Blur: dof_a → dof_b (half resolution) ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = bloom_render_pass_;
        rp_info.framebuffer = dof_b_framebuffer_;
        rp_info.renderArea.extent = {dof_width_, dof_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, dof_blur_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, bloom_pipeline_layout_,
                                0, 1, &ds_dof_a_, 0, nullptr);

        struct { float dir_x; float dir_y; float texel_x; float texel_y; } dof_v_pc;
        dof_v_pc.dir_x = 0.0f;
        dof_v_pc.dir_y = 1.0f;
        dof_v_pc.texel_x = dof_texel[0];
        dof_v_pc.texel_y = dof_texel[1];
        vkCmdPushConstants(cmd, bloom_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 16, &dof_v_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        vkCmdEndRenderPass(cmd);
    }

    // --- Composite: begin render pass (caller will end it after drawing UI) ---
    {
        VkRenderPassBeginInfo rp_info{};
        rp_info.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
        rp_info.renderPass = composite_render_pass_;
        rp_info.framebuffer = composite_framebuffers_[swapchain_index];
        rp_info.renderArea.extent = {scene_width_, scene_height_};

        vkCmdBeginRenderPass(cmd, &rp_info, VK_SUBPASS_CONTENTS_INLINE);
        vkCmdBindPipeline(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, composite_pipeline_);
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, composite_pipeline_layout_,
                                0, 1, &ds_composite_, 0, nullptr);

        // 80B push constant: 5 × vec4
        float near = params.dof_near_plane;
        float far = params.dof_far_plane;
        struct {
            float bloom_intensity; float exposure;
            float vignette_radius; float vignette_softness;
            float dof_focus_distance; float dof_focus_range;
            float dof_max_blur; float pad0;
            float depth_A; float depth_B;
            float fog_density; float pad1;
            float fog_r; float fog_g;
            float fog_b; float fade_amount;
            float ca_intensity; float flash_r;
            float flash_g; float flash_b;
        } comp_pc;
        comp_pc.bloom_intensity = params.bloom_intensity;
        comp_pc.exposure = params.exposure;
        comp_pc.vignette_radius = params.vignette_radius;
        comp_pc.vignette_softness = params.vignette_softness;
        comp_pc.dof_focus_distance = params.dof_focus_distance;
        comp_pc.dof_focus_range = params.dof_focus_range;
        comp_pc.dof_max_blur = params.dof_max_blur;
        comp_pc.pad0 = 0.0f;
        comp_pc.depth_A = far / (far - near);
        comp_pc.depth_B = (near * far) / (far - near);
        comp_pc.fog_density = params.fog_density;
        comp_pc.pad1 = 0.0f;
        comp_pc.fog_r = params.fog_color_r;
        comp_pc.fog_g = params.fog_color_g;
        comp_pc.fog_b = params.fog_color_b;
        comp_pc.fade_amount = params.fade_amount;
        comp_pc.ca_intensity = params.ca_intensity;
        comp_pc.flash_r = params.flash_r;
        comp_pc.flash_g = params.flash_g;
        comp_pc.flash_b = params.flash_b;
        vkCmdPushConstants(cmd, composite_pipeline_layout_, VK_SHADER_STAGE_FRAGMENT_BIT,
                           0, 80, &comp_pc);

        vkCmdDraw(cmd, 3, 1, 0, 0);
        // NOTE: render pass left open for UI drawing. Caller must end it.
    }
}

void PostProcessPipeline::update_light_glow(VmaAllocator allocator,
                                             const LightGlowData& data) {
    if (!light_glow_buffer_) return;
    void* mapped = nullptr;
    vmaMapMemory(allocator, light_glow_alloc_, &mapped);
    std::memcpy(mapped, &data, sizeof(data));
    vmaUnmapMemory(allocator, light_glow_alloc_);
}

}  // namespace gseurat
