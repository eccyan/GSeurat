// Phase 3b: Unit tests for RenderState's writer + DirtyRange + frame
// isolation logic. Writers are constructed against heap-backed storage
// so the entire test runs without a VkContext or VMA. RenderState's
// Vulkan-backed paths are exercised separately by the demo smoke test.

#include "gseurat/engine/render_state.hpp"
#include "gseurat/engine/types.hpp"

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

#include <array>
#include <cassert>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <vector>

using namespace gseurat;

namespace {

// Probe a typed writer against a heap-backed vector. Returns the dirty
// range produced by writes.
template <typename T>
DirtyRange write_through(std::vector<T>& storage, std::span<const std::pair<uint32_t, T>> ops) {
    DirtyRange dirty;
    TypedSlotWriter<T> w{storage.data(), static_cast<uint32_t>(storage.size()), &dirty};
    for (const auto& [slot, value] : ops) {
        w.write(slot, value);
    }
    return dirty;
}

}  // namespace

int main() {
    // 1. TypedSlotWriter writes to mapped storage at the correct slot
    {
        std::vector<glm::mat4> storage(4, glm::mat4{0.0f});
        DirtyRange dirty;
        BonesWriter w{storage.data(), 4, &dirty};

        glm::mat4 m = glm::translate(glm::mat4(1.0f), glm::vec3(1, 2, 3));
        w.write(2, m);

        assert(storage[0] == glm::mat4{0.0f});
        assert(storage[1] == glm::mat4{0.0f});
        assert(storage[2] == m);
        assert(storage[3] == glm::mat4{0.0f});
        std::printf("PASS: TypedSlotWriter writes to correct slot\n");
    }

    // 2. TypedSlotWriter rejects out-of-range slots without writing
    {
        std::vector<glm::mat4> storage(4, glm::mat4{0.0f});
        DirtyRange dirty;
        BonesWriter w{storage.data(), 4, &dirty};

        glm::mat4 m = glm::translate(glm::mat4(1.0f), glm::vec3(5, 5, 5));
        w.write(4, m);   // exactly at capacity → reject
        w.write(99, m);  // far past → reject

        for (const auto& slot : storage) {
            assert(slot == glm::mat4{0.0f});
        }
        assert(dirty.empty());
        std::printf("PASS: TypedSlotWriter rejects out-of-range slots\n");
    }

    // 3. DirtyRange spans cover the [min, max] of touched slots
    {
        std::vector<glm::mat4> storage(16, glm::mat4{0.0f});
        DirtyRange dirty;
        BonesWriter w{storage.data(), 16, &dirty};

        assert(dirty.empty());

        w.write(7, glm::mat4(1.0f));
        assert(!dirty.empty());
        assert(dirty.first == 7 && dirty.last == 7);

        w.write(3, glm::mat4(1.0f));
        assert(dirty.first == 3 && dirty.last == 7);

        w.write(12, glm::mat4(1.0f));
        assert(dirty.first == 3 && dirty.last == 12);

        dirty.clear();
        assert(dirty.empty());
        std::printf("PASS: DirtyRange tracks min/max across writes\n");
    }

    // 4. Out-of-range writes don't mutate the dirty range
    {
        std::vector<glm::mat4> storage(8, glm::mat4{0.0f});
        DirtyRange dirty;
        BonesWriter w{storage.data(), 8, &dirty};

        w.write(3, glm::mat4(1.0f));
        assert(dirty.first == 3 && dirty.last == 3);

        w.write(100, glm::mat4(1.0f));
        assert(dirty.first == 3 && dirty.last == 3);
        std::printf("PASS: rejected writes leave DirtyRange intact\n");
    }

    // 5. BytesSlotWriter writes the right stride at the right offset
    {
        constexpr std::size_t kStride = 64;
        std::vector<std::byte> storage(kStride * 4, std::byte{0});
        DirtyRange dirty;
        VfxWriter w{storage.data(), 4, kStride, &dirty};

        std::array<std::byte, kStride> payload;
        for (std::size_t i = 0; i < kStride; ++i) {
            payload[i] = static_cast<std::byte>(i + 1);
        }

        w.write_bytes(2, std::span<const std::byte>{payload.data(), kStride});

        // Slot 0 + 1 + 3 untouched
        for (std::size_t s : {0u, 1u, 3u}) {
            for (std::size_t i = 0; i < kStride; ++i) {
                assert(storage[s * kStride + i] == std::byte{0});
            }
        }
        // Slot 2 contains payload
        for (std::size_t i = 0; i < kStride; ++i) {
            assert(storage[2 * kStride + i] == payload[i]);
        }
        assert(dirty.first == 2 && dirty.last == 2);
        std::printf("PASS: BytesSlotWriter writes correct stride/offset\n");
    }

    // 6. BytesSlotWriter rejects mismatched payload sizes (silent in release)
    {
        constexpr std::size_t kStride = 64;
        std::vector<std::byte> storage(kStride * 2, std::byte{0xAA});
        DirtyRange dirty;
        VfxWriter w{storage.data(), 2, kStride, &dirty};

        std::array<std::byte, 32> too_small{};  // half the expected stride
        w.write_bytes(0, std::span<const std::byte>{too_small.data(), too_small.size()});

        // Storage and dirty range untouched
        for (auto b : storage) assert(b == std::byte{0xAA});
        assert(dirty.empty());
        std::printf("PASS: BytesSlotWriter rejects mismatched payload size\n");
    }

    // 7. BytesSlotWriter::write_at convenience overload
    {
        constexpr std::size_t kStride = 16;
        std::vector<std::byte> storage(kStride * 2, std::byte{0});
        DirtyRange dirty;
        VfxWriter w{storage.data(), 2, kStride, &dirty};

        std::array<uint32_t, 4> data = {0xDEADBEEF, 0xCAFEBABE, 0x12345678, 0x9ABCDEF0};
        w.write_at(1, data.data(), sizeof(data));

        // Slot 0 untouched
        for (std::size_t i = 0; i < kStride; ++i) {
            assert(storage[i] == std::byte{0});
        }
        // Slot 1 has the words
        std::array<uint32_t, 4> readback{};
        std::memcpy(readback.data(), storage.data() + kStride, kStride);
        assert(readback[0] == 0xDEADBEEF);
        assert(readback[3] == 0x9ABCDEF0);
        assert(dirty.first == 1 && dirty.last == 1);
        std::printf("PASS: BytesSlotWriter::write_at copies raw bytes\n");
    }

    // 8. Null-mapped writer is a no-op (defensive — exercises the early return)
    {
        DirtyRange dirty;
        BonesWriter w{nullptr, 4, &dirty};
        assert(!w.valid());
        w.write(0, glm::mat4(1.0f));  // must not crash
        assert(dirty.empty());

        VfxWriter bw{nullptr, 4, 64, &dirty};
        std::array<std::byte, 64> payload{};
        bw.write_bytes(0, std::span<const std::byte>{payload.data(), payload.size()});
        assert(dirty.empty());
        std::printf("PASS: null-mapped writer is no-op\n");
    }

    // 9. Frame-in-flight isolation: writes to one frame's dirty range don't
    //    affect the other. Simulates the per-frame ownership inside
    //    RenderState by spawning two independent writer + dirty range pairs.
    {
        std::array<std::vector<glm::mat4>, kMaxFramesInFlight> storages;
        std::array<DirtyRange, kMaxFramesInFlight> dirties;
        for (auto& s : storages) s.assign(8, glm::mat4{0.0f});

        BonesWriter w0{storages[0].data(), 8, &dirties[0]};
        BonesWriter w1{storages[1].data(), 8, &dirties[1]};

        glm::mat4 m0 = glm::translate(glm::mat4(1.0f), glm::vec3(1));
        glm::mat4 m1 = glm::translate(glm::mat4(1.0f), glm::vec3(2));

        w0.write(2, m0);
        w1.write(5, m1);

        // Frame 0 sees its own write only
        assert(storages[0][2] == m0);
        assert(storages[0][5] == glm::mat4{0.0f});
        assert(dirties[0].first == 2 && dirties[0].last == 2);

        // Frame 1 sees its own write only
        assert(storages[1][5] == m1);
        assert(storages[1][2] == glm::mat4{0.0f});
        assert(dirties[1].first == 5 && dirties[1].last == 5);
        std::printf("PASS: per-frame writers and dirty ranges are isolated\n");
    }

    // 10. PointLightsWriter (typed for the existing PointLight POD)
    {
        std::vector<PointLight> lights(kMaxLights);
        DirtyRange dirty;
        PointLightsWriter w{lights.data(), kMaxLights, &dirty};

        PointLight pl;
        pl.position_and_radius = {10.0f, 5.0f, 3.0f, 7.5f};
        pl.color = {1.0f, 0.5f, 0.25f, 2.0f};
        w.write(3, pl);

        assert(lights[3].position_and_radius.w == 7.5f);
        assert(lights[3].color.r == 1.0f);
        assert(dirty.first == 3 && dirty.last == 3);
        std::printf("PASS: PointLightsWriter handles PointLight POD\n");
    }

    std::printf("\nALL RENDER STATE TESTS PASSED\n");
    return 0;
}
