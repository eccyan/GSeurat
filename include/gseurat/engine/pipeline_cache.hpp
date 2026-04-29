#pragma once

#include <vulkan/vulkan.h>

#include <filesystem>
#include <span>

namespace gseurat {

// Disk-backed VkPipelineCache wrapper.
//
// On init(), attempts to load a previously-saved cache blob from `path` and
// validates its header (length / version / vendorID / deviceID / UUID) against
// the current physical device. Mismatch or any I/O failure is non-fatal — we
// fall back to an empty cache. The VkPipelineCache handle is always valid
// after a successful init() (driver allocation is the only hard failure).
//
// On save(), retrieves the current cache contents from the driver and writes
// them atomically (temp file + rename). Errors are logged to stderr but never
// thrown — losing the cache is a perf hit, not a correctness bug.
class PipelineCache {
public:
    PipelineCache() = default;
    ~PipelineCache() = default;

    PipelineCache(const PipelineCache&) = delete;
    PipelineCache& operator=(const PipelineCache&) = delete;
    PipelineCache(PipelineCache&&) = delete;
    PipelineCache& operator=(PipelineCache&&) = delete;

    // Initialize the cache. Pass an empty `path` for an in-memory-only cache
    // (e.g. headless tests) — load attempts and save() become no-ops, but
    // the cache still deduplicates shader compiles within a single process.
    // Returns true if existing on-disk data was loaded; false if started fresh.
    bool init(VkDevice device, VkPhysicalDevice physical_device,
              std::filesystem::path path);

    // Persist current cache contents to disk. Safe to call multiple times,
    // and a no-op if `path` is empty or init() was never called.
    void save() const;

    // Destroy the underlying VkPipelineCache. Safe to call without init().
    void shutdown(VkDevice device);

    VkPipelineCache handle() const { return cache_; }
    const std::filesystem::path& path() const { return path_; }

private:
    // Validate the 32-byte VkPipelineCacheHeaderVersionOne preamble against
    // the current physical device's properties.
    static bool header_matches(std::span<const std::byte> blob,
                               const VkPhysicalDeviceProperties& props);

    VkDevice device_ = VK_NULL_HANDLE;
    VkPipelineCache cache_ = VK_NULL_HANDLE;
    std::filesystem::path path_;
};

} // namespace gseurat
