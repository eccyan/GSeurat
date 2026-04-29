#include "gseurat/engine/pipeline_cache.hpp"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

namespace gseurat {

namespace {
constexpr std::size_t kVkPipelineCacheHeaderSize = 32;
}  // namespace

bool PipelineCache::header_matches(std::span<const std::byte> blob,
                                   const VkPhysicalDeviceProperties& props) {
    if (blob.size() < kVkPipelineCacheHeaderSize) return false;

    // VkPipelineCacheHeaderVersionOne layout (Vulkan 1.0+):
    //    0 .. 3   uint32  headerLength      (== 32)
    //    4 .. 7   uint32  headerVersion     (== VK_PIPELINE_CACHE_HEADER_VERSION_ONE = 1)
    //    8 .. 11  uint32  vendorID
    //   12 .. 15  uint32  deviceID
    //   16 .. 31  uint8[VK_UUID_SIZE]  pipelineCacheUUID  (16 bytes)
    std::uint32_t header_len = 0;
    std::uint32_t header_ver = 0;
    std::uint32_t vendor_id = 0;
    std::uint32_t device_id = 0;
    std::memcpy(&header_len, blob.data() + 0,  4);
    std::memcpy(&header_ver, blob.data() + 4,  4);
    std::memcpy(&vendor_id,  blob.data() + 8,  4);
    std::memcpy(&device_id,  blob.data() + 12, 4);

    if (header_len != kVkPipelineCacheHeaderSize) return false;
    if (header_ver != VK_PIPELINE_CACHE_HEADER_VERSION_ONE) return false;
    if (vendor_id != props.vendorID) return false;
    if (device_id != props.deviceID) return false;
    if (std::memcmp(blob.data() + 16, props.pipelineCacheUUID, VK_UUID_SIZE) != 0) {
        return false;
    }
    return true;
}

bool PipelineCache::init(VkDevice device, VkPhysicalDevice physical_device,
                         std::filesystem::path path) {
    device_ = device;
    path_   = std::move(path);

    VkPhysicalDeviceProperties props{};
    vkGetPhysicalDeviceProperties(physical_device, &props);

    std::vector<std::byte> initial_data;

    if (!path_.empty()) {
        std::error_code ec;
        if (std::filesystem::exists(path_, ec) && !ec) {
            std::ifstream file(path_, std::ios::binary | std::ios::ate);
            if (file) {
                auto size = static_cast<std::streamoff>(file.tellg());
                if (size > 0) {
                    initial_data.resize(static_cast<std::size_t>(size));
                    file.seekg(0);
                    file.read(reinterpret_cast<char*>(initial_data.data()), size);
                    if (!file) {
                        std::fprintf(stderr,
                            "[PipelineCache] read failed for %s; starting fresh\n",
                            path_.string().c_str());
                        initial_data.clear();
                    }
                }
            }
        }

        if (!initial_data.empty() && !header_matches(initial_data, props)) {
            std::fprintf(stderr,
                "[PipelineCache] header mismatch (driver/device changed?); starting fresh\n");
            initial_data.clear();
        }
    }

    VkPipelineCacheCreateInfo info{};
    info.sType = VK_STRUCTURE_TYPE_PIPELINE_CACHE_CREATE_INFO;
    info.initialDataSize = initial_data.size();
    info.pInitialData    = initial_data.empty() ? nullptr : initial_data.data();

    VkResult res = vkCreatePipelineCache(device_, &info, nullptr, &cache_);
    if (res != VK_SUCCESS) {
        // Some drivers reject blobs the header check accepts (Vulkan permits
        // implementation-defined post-header validation). Retry with empty data.
        std::fprintf(stderr,
            "[PipelineCache] vkCreatePipelineCache(%zu B) failed (%d); retrying empty\n",
            initial_data.size(), static_cast<int>(res));
        info.initialDataSize = 0;
        info.pInitialData    = nullptr;
        res = vkCreatePipelineCache(device_, &info, nullptr, &cache_);
        if (res != VK_SUCCESS) {
            std::fprintf(stderr,
                "[PipelineCache] empty creation also failed (%d); cache disabled\n",
                static_cast<int>(res));
            cache_ = VK_NULL_HANDLE;
        }
        return false;
    }

    bool loaded_existing = !initial_data.empty();
    if (loaded_existing) {
        std::fprintf(stderr,
            "[PipelineCache] loaded %zu bytes from %s\n",
            initial_data.size(), path_.string().c_str());
    } else if (!path_.empty()) {
        std::fprintf(stderr,
            "[PipelineCache] starting empty (will save to %s on shutdown)\n",
            path_.string().c_str());
    }
    return loaded_existing;
}

void PipelineCache::save() const {
    if (cache_  == VK_NULL_HANDLE) return;
    if (device_ == VK_NULL_HANDLE) return;
    if (path_.empty())             return;

    std::size_t data_size = 0;
    VkResult res = vkGetPipelineCacheData(device_, cache_, &data_size, nullptr);
    if (res != VK_SUCCESS) {
        std::fprintf(stderr,
            "[PipelineCache] vkGetPipelineCacheData size query failed (%d)\n",
            static_cast<int>(res));
        return;
    }
    if (data_size == 0) return;  // nothing to save (e.g. no pipelines created)

    std::vector<std::byte> data(data_size);
    res = vkGetPipelineCacheData(device_, cache_, &data_size, data.data());
    if (res != VK_SUCCESS) {
        std::fprintf(stderr,
            "[PipelineCache] vkGetPipelineCacheData fetch failed (%d)\n",
            static_cast<int>(res));
        return;
    }
    data.resize(data_size);

    std::error_code ec;
    if (auto parent = path_.parent_path(); !parent.empty()) {
        std::filesystem::create_directories(parent, ec);
        if (ec) {
            std::fprintf(stderr,
                "[PipelineCache] create_directories(%s) failed: %s\n",
                parent.string().c_str(), ec.message().c_str());
            return;
        }
    }

    auto tmp_path = path_;
    tmp_path += ".tmp";
    {
        std::ofstream file(tmp_path, std::ios::binary | std::ios::trunc);
        if (!file) {
            std::fprintf(stderr,
                "[PipelineCache] open(%s) for write failed\n",
                tmp_path.string().c_str());
            return;
        }
        file.write(reinterpret_cast<const char*>(data.data()),
                   static_cast<std::streamsize>(data.size()));
        if (!file) {
            std::fprintf(stderr,
                "[PipelineCache] write to %s failed\n",
                tmp_path.string().c_str());
            file.close();
            std::filesystem::remove(tmp_path, ec);
            return;
        }
    }

    std::filesystem::rename(tmp_path, path_, ec);
    if (ec) {
        std::fprintf(stderr,
            "[PipelineCache] rename(%s -> %s) failed: %s\n",
            tmp_path.string().c_str(), path_.string().c_str(),
            ec.message().c_str());
        std::filesystem::remove(tmp_path, ec);
        return;
    }

    std::fprintf(stderr, "[PipelineCache] saved %zu bytes to %s\n",
                 data_size, path_.string().c_str());
}

void PipelineCache::shutdown(VkDevice device) {
    if (cache_ != VK_NULL_HANDLE) {
        vkDestroyPipelineCache(device, cache_, nullptr);
        cache_ = VK_NULL_HANDLE;
    }
    device_ = VK_NULL_HANDLE;
}

} // namespace gseurat
