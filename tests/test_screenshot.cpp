// Unit test: ScreenshotCapture — state machine + BGRA→RGBA swizzle
//
// Build:
//   c++ -std=c++23 -I include \
//       -I build/macos-debug/_deps/glm-src \
//       -I build/macos-debug/_deps/stb-src \
//       -I build/macos-debug/_deps/vma-src/include \
//       $(pkg-config --cflags vulkan 2>/dev/null || echo "-I$VULKAN_SDK/include") \
//       tests/test_screenshot.cpp src/engine/screenshot.cpp \
//       -o build/test_screenshot
//
// Run: ./build/test_screenshot

#include "vulkan_game/engine/screenshot.hpp"

#include <cassert>
#include <cstdint>
#include <cstdio>

// Linker stubs for symbols referenced by screenshot.cpp but not exercised by tests
extern "C" {
void vkCmdPipelineBarrier(VkCommandBuffer, VkPipelineStageFlags, VkPipelineStageFlags,
                          VkDependencyFlags, uint32_t, const VkMemoryBarrier*,
                          uint32_t, const VkBufferMemoryBarrier*,
                          uint32_t, const VkImageMemoryBarrier*) {}
void vkCmdCopyImageToBuffer(VkCommandBuffer, VkImage, VkImageLayout,
                            VkBuffer, uint32_t, const VkBufferImageCopy*) {}
VkResult vmaInvalidateAllocation(VmaAllocator, VmaAllocation, VkDeviceSize, VkDeviceSize) {
    return VK_SUCCESS;
}
int stbi_write_png(const char*, int, int, int, const void*, int) { return 0; }
}

// Stubs for Buffer methods referenced by ScreenshotCapture
namespace vulkan_game {
Buffer Buffer::create_readback(VmaAllocator, VkDeviceSize) { return Buffer{}; }
void Buffer::destroy(VmaAllocator) {}
}

using namespace vulkan_game;

// ──── Group A: ScreenshotCapture state machine ────

void test_initial_state_not_pending() {
    ScreenshotCapture cap;
    assert(!cap.has_pending());
    std::printf("PASS: initial state not pending\n");
}

void test_request_sets_pending() {
    ScreenshotCapture cap;
    cap.request("out.png");
    assert(cap.has_pending());
    std::printf("PASS: request sets pending\n");
}

void test_initial_write_ok_false() {
    ScreenshotCapture cap;
    assert(!cap.write_ok());
    std::printf("PASS: initial write_ok false\n");
}

// ──── Group B: BGRA→RGBA swizzle ────

void test_swizzle_4_pixels() {
    // BGRA input: 4 pixels with distinct channel values
    const uint8_t src[] = {
        // pixel 0: B=10, G=20, R=30, A=40
        10, 20, 30, 40,
        // pixel 1: B=50, G=60, R=70, A=80
        50, 60, 70, 80,
        // pixel 2: B=100, G=110, R=120, A=130
        100, 110, 120, 130,
        // pixel 3: B=200, G=210, R=220, A=230
        200, 210, 220, 230,
    };
    uint8_t dst[16] = {};

    swizzle_bgra_to_rgba(src, dst, 4);

    // pixel 0: R=30, G=20, B=10, A=255
    assert(dst[0] == 30);
    assert(dst[1] == 20);
    assert(dst[2] == 10);
    assert(dst[3] == 255);

    // pixel 1: R=70, G=60, B=50, A=255
    assert(dst[4] == 70);
    assert(dst[5] == 60);
    assert(dst[6] == 50);
    assert(dst[7] == 255);

    // pixel 2: R=120, G=110, B=100, A=255
    assert(dst[8] == 120);
    assert(dst[9] == 110);
    assert(dst[10] == 100);
    assert(dst[11] == 255);

    // pixel 3: R=220, G=210, B=200, A=255
    assert(dst[12] == 220);
    assert(dst[13] == 210);
    assert(dst[14] == 200);
    assert(dst[15] == 255);

    std::printf("PASS: BGRA→RGBA swizzle 4 pixels\n");
}

void test_swizzle_single_pixel() {
    const uint8_t src[] = {0, 128, 255, 64};  // B=0, G=128, R=255, A=64
    uint8_t dst[4] = {};

    swizzle_bgra_to_rgba(src, dst, 1);

    assert(dst[0] == 255);  // R
    assert(dst[1] == 128);  // G
    assert(dst[2] == 0);    // B
    assert(dst[3] == 255);  // A forced to 255

    std::printf("PASS: BGRA→RGBA swizzle single pixel\n");
}

int main() {
    // Group A: state machine
    test_initial_state_not_pending();
    test_request_sets_pending();
    test_initial_write_ok_false();

    // Group B: swizzle
    test_swizzle_4_pixels();
    test_swizzle_single_pixel();

    std::printf("\nAll screenshot tests passed.\n");
    return 0;
}
