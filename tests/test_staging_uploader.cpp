// Unit test: StagingUploader — queue mechanics, budget enforcement
//
// Build:
//   c++ -std=c++23 -I include \
//       -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/stb-src \
//       -I build/macos-debug/_deps/vma-src/include \
//       $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
//       tests/test_staging_uploader.cpp src/engine/staging_uploader.cpp \
//       -o build/test_staging_uploader
//
// Run: ./build/test_staging_uploader

#include "gseurat/engine/staging_uploader.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace gseurat;

// --- Linker stubs for Vulkan/VMA functions referenced by staging_uploader.cpp ---
// These allow testing queue logic without a live Vulkan device.

static int g_stub_images_created = 0;
static int g_stub_submits = 0;
static int g_stub_fences_waited = 0;
static int g_stub_fences_reset = 0;

static void reset_stubs() {
    g_stub_images_created = 0;
    g_stub_submits = 0;
    g_stub_fences_waited = 0;
    g_stub_fences_reset = 0;
}

extern "C" {

VkResult vkCreateFence(VkDevice, const VkFenceCreateInfo*, const VkAllocationCallbacks*,
                       VkFence* out) {
    // Return a fake non-null handle
    *out = reinterpret_cast<VkFence>(0x1);
    return VK_SUCCESS;
}

void vkDestroyFence(VkDevice, VkFence, const VkAllocationCallbacks*) {}

VkResult vkWaitForFences(VkDevice, uint32_t, const VkFence*, VkBool32, uint64_t) {
    ++g_stub_fences_waited;
    return VK_SUCCESS;
}

VkResult vkResetFences(VkDevice, uint32_t, const VkFence*) {
    ++g_stub_fences_reset;
    return VK_SUCCESS;
}

VkResult vkGetFenceStatus(VkDevice, VkFence) {
    return VK_SUCCESS;
}

VkResult vkAllocateCommandBuffers(VkDevice, const VkCommandBufferAllocateInfo*,
                                   VkCommandBuffer* out) {
    *out = reinterpret_cast<VkCommandBuffer>(0x2);
    return VK_SUCCESS;
}

void vkFreeCommandBuffers(VkDevice, VkCommandPool, uint32_t, const VkCommandBuffer*) {}

VkResult vkBeginCommandBuffer(VkCommandBuffer, const VkCommandBufferBeginInfo*) {
    return VK_SUCCESS;
}

VkResult vkEndCommandBuffer(VkCommandBuffer) {
    return VK_SUCCESS;
}

VkResult vkQueueSubmit(VkQueue, uint32_t, const VkSubmitInfo*, VkFence) {
    ++g_stub_submits;
    return VK_SUCCESS;
}

VkResult vkQueueWaitIdle(VkQueue) {
    return VK_SUCCESS;
}

void vkCmdPipelineBarrier(VkCommandBuffer, VkPipelineStageFlags, VkPipelineStageFlags,
                          VkDependencyFlags, uint32_t, const VkMemoryBarrier*,
                          uint32_t, const VkBufferMemoryBarrier*,
                          uint32_t, const VkImageMemoryBarrier*) {}

void vkCmdCopyBufferToImage(VkCommandBuffer, VkBuffer, VkImage, VkImageLayout,
                            uint32_t, const VkBufferImageCopy*) {}

VkResult vkCreateImageView(VkDevice, const VkImageViewCreateInfo*, const VkAllocationCallbacks*,
                           VkImageView* out) {
    *out = reinterpret_cast<VkImageView>(0x3);
    return VK_SUCCESS;
}

void vkDestroyImageView(VkDevice, VkImageView, const VkAllocationCallbacks*) {}

VkResult vkCreateSampler(VkDevice, const VkSamplerCreateInfo*, const VkAllocationCallbacks*,
                         VkSampler* out) {
    *out = reinterpret_cast<VkSampler>(0x4);
    return VK_SUCCESS;
}

void vkDestroySampler(VkDevice, VkSampler, const VkAllocationCallbacks*) {}

VkResult vmaCreateImage(VmaAllocator, const VkImageCreateInfo*, const VmaAllocationCreateInfo*,
                        VkImage* out, VmaAllocation* alloc, VmaAllocationInfo*) {
    *out = reinterpret_cast<VkImage>(0x5);
    *alloc = reinterpret_cast<VmaAllocation>(0x6);
    ++g_stub_images_created;
    return VK_SUCCESS;
}

void vmaDestroyImage(VmaAllocator, VkImage, VmaAllocation) {}

VkResult vmaCreateBuffer(VmaAllocator, const VkBufferCreateInfo*, const VmaAllocationCreateInfo*,
                         VkBuffer* out, VmaAllocation* alloc, VmaAllocationInfo*) {
    *out = reinterpret_cast<VkBuffer>(0x7);
    *alloc = reinterpret_cast<VmaAllocation>(0x8);
    return VK_SUCCESS;
}

void vmaDestroyBuffer(VmaAllocator, VkBuffer, VmaAllocation) {}

VkResult vmaMapMemory(VmaAllocator, VmaAllocation, void** out) {
    // Return a valid writable region (stack buffer is fine for tests — we never read back)
    static uint8_t dummy[1024 * 1024];  // 1 MB dummy
    *out = dummy;
    return VK_SUCCESS;
}

void vmaUnmapMemory(VmaAllocator, VmaAllocation) {}

}  // extern "C"

// Stubs for Buffer and Texture methods used by StagingUploader
namespace gseurat {

Buffer Buffer::create_staging(VmaAllocator, VkDeviceSize) {
    return Buffer{};
}

void Buffer::upload(const void*, VkDeviceSize) {}

void Buffer::destroy(VmaAllocator) {}

Texture Texture::create_from_image(VkDevice device,
                                    VkImage image, VmaAllocation allocation,
                                    VkFormat format, VkFilter filter,
                                    VkSamplerAddressMode address_mode) {
    (void)device; (void)image; (void)allocation;
    (void)format; (void)filter; (void)address_mode;
    return Texture{};
}

}  // namespace gseurat

// Helper: create a StagedTexture with given dimensions (pixels filled with 0xFF)
static StagedTexture make_staged(const std::string& key, uint32_t w, uint32_t h) {
    StagedTexture st;
    st.cache_key = key;
    st.width = w;
    st.height = h;
    st.pixels.resize(w * h * 4, 0xFF);
    return st;
}

int main() {
    // 1. enqueue adds to pending, pending_count and pending_bytes track correctly
    {
        StagingUploader uploader;
        std::vector<std::string> ready_keys;
        uploader.init(reinterpret_cast<VkDevice>(0x10),
                      reinterpret_cast<VmaAllocator>(0x11),
                      reinterpret_cast<VkCommandPool>(0x12),
                      reinterpret_cast<VkQueue>(0x13),
                      [&](const std::string& key, Texture) { ready_keys.push_back(key); });

        assert(uploader.pending_count() == 0);
        assert(uploader.pending_bytes() == 0);

        uploader.enqueue_texture(make_staged("tex_a", 16, 16));  // 16*16*4 = 1024 bytes
        assert(uploader.pending_count() == 1);
        assert(uploader.pending_bytes() == 1024);

        uploader.enqueue_texture(make_staged("tex_b", 32, 32));  // 32*32*4 = 4096 bytes
        assert(uploader.pending_count() == 2);
        assert(uploader.pending_bytes() == 1024 + 4096);

        uploader.shutdown();
        std::printf("PASS: enqueue tracking\n");
    }

    // 2. flush processes all textures within budget
    {
        reset_stubs();
        StagingUploader uploader;
        std::vector<std::string> ready_keys;
        uploader.init(reinterpret_cast<VkDevice>(0x10),
                      reinterpret_cast<VmaAllocator>(0x11),
                      reinterpret_cast<VkCommandPool>(0x12),
                      reinterpret_cast<VkQueue>(0x13),
                      [&](const std::string& key, Texture) { ready_keys.push_back(key); });

        uploader.enqueue_texture(make_staged("small1", 8, 8));   // 256 bytes
        uploader.enqueue_texture(make_staged("small2", 8, 8));   // 256 bytes

        // Large budget — should process both
        uint32_t count = uploader.flush(1024 * 1024);
        assert(count == 2);
        assert(uploader.pending_count() == 0);
        assert(g_stub_images_created == 2);

        uploader.shutdown();
        std::printf("PASS: flush processes all within budget\n");
    }

    // 3. flush respects budget — partial processing
    {
        reset_stubs();
        StagingUploader uploader;
        std::vector<std::string> ready_keys;
        uploader.init(reinterpret_cast<VkDevice>(0x10),
                      reinterpret_cast<VmaAllocator>(0x11),
                      reinterpret_cast<VkCommandPool>(0x12),
                      reinterpret_cast<VkQueue>(0x13),
                      [&](const std::string& key, Texture) { ready_keys.push_back(key); });

        // Each is 64*64*4 = 16384 bytes
        uploader.enqueue_texture(make_staged("a", 64, 64));
        uploader.enqueue_texture(make_staged("b", 64, 64));
        uploader.enqueue_texture(make_staged("c", 64, 64));

        // Budget for only 1 texture (16384 bytes)
        uint32_t count = uploader.flush(16384);
        assert(count == 1);
        assert(uploader.pending_count() == 2);

        // Second flush picks up more
        count = uploader.flush(16384);
        assert(count == 1);
        assert(uploader.pending_count() == 1);

        // Third flush finishes
        count = uploader.flush(16384);
        assert(count == 1);
        assert(uploader.pending_count() == 0);

        uploader.shutdown();
        std::printf("PASS: flush respects budget\n");
    }

    // 4. Empty flush is a no-op (no submits)
    {
        reset_stubs();
        StagingUploader uploader;
        uploader.init(reinterpret_cast<VkDevice>(0x10),
                      reinterpret_cast<VmaAllocator>(0x11),
                      reinterpret_cast<VkCommandPool>(0x12),
                      reinterpret_cast<VkQueue>(0x13),
                      [](const std::string&, Texture) {});

        uint32_t count = uploader.flush();
        assert(count == 0);
        assert(g_stub_submits == 0);

        uploader.shutdown();
        std::printf("PASS: empty flush no-op\n");
    }

    // 5. Callback receives correct cache keys
    {
        reset_stubs();
        StagingUploader uploader;
        std::vector<std::string> ready_keys;
        uploader.init(reinterpret_cast<VkDevice>(0x10),
                      reinterpret_cast<VmaAllocator>(0x11),
                      reinterpret_cast<VkCommandPool>(0x12),
                      reinterpret_cast<VkQueue>(0x13),
                      [&](const std::string& key, Texture) { ready_keys.push_back(key); });

        uploader.enqueue_texture(make_staged("first", 4, 4));
        uploader.enqueue_texture(make_staged("second", 4, 4));

        uploader.flush(1024 * 1024);  // Uploads into slot 0, advances to slot 1

        // Double-buffer: slot 0 results are retired when slot 0 is reused.
        // flush() cycles: slot 1 → slot 0, so we need two more flushes.
        uploader.flush(0);  // Retires slot 1 (empty), advances to slot 0
        uploader.flush(0);  // Retires slot 0 (our textures!), advances to slot 1

        assert(ready_keys.size() == 2);
        assert(ready_keys[0] == "first");
        assert(ready_keys[1] == "second");

        uploader.shutdown();
        std::printf("PASS: callback receives correct keys\n");
    }

    // 6. byte_size calculation
    {
        StagedTexture st;
        st.width = 100;
        st.height = 50;
        assert(st.byte_size() == 100 * 50 * 4);
        std::printf("PASS: byte_size calculation\n");
    }

    std::printf("\nAll staging_uploader tests passed.\n");
    return 0;
}
