// include/gseurat/engine/debug.hpp
#pragma once

#include <vulkan/vulkan.h>
#include <glm/vec4.hpp>
#include <cstdint>

#ifndef GSEURAT_DEBUG_BUILD
#  define GSEURAT_DEBUG_BUILD 0
#endif

namespace gs::dbg {

inline constexpr bool kEnabled = (GSEURAT_DEBUG_BUILD != 0);

// === Tier B: RAII Vulkan Debug Utils label ===
class ScopedLabel {
 public:
  ScopedLabel(VkCommandBuffer cmd, const char* name,
              glm::vec4 color = {0.5f, 0.5f, 0.5f, 1.0f}) noexcept;
  ~ScopedLabel() noexcept;

  ScopedLabel(const ScopedLabel&) = delete;
  ScopedLabel& operator=(const ScopedLabel&) = delete;
  ScopedLabel(ScopedLabel&&) = delete;
  ScopedLabel& operator=(ScopedLabel&&) = delete;

 private:
  VkCommandBuffer cmd_;
};

// === Tier B: object naming ===
void set_object_name(VkDevice device, VkObjectType type,
                     std::uint64_t handle, const char* name) noexcept;

// === Tier C: env-var diag registry ===
enum class Diag : std::uint16_t {
  StreamingState,    // GS_DIAG_STREAMING
  GpuTiming,         // GS_DIAG_GPU_TIMING
  ChunkInventory,    // GS_DIAG_CHUNKS
  RenderStateSlots,  // GS_DIAG_RENDERSTATE
  EventQueueSizes,   // GS_DIAG_EVENTS
  COUNT_
};

bool enabled(Diag) noexcept;

// === Lifecycle (called from VkContext) ===
void init_function_pointers(VkInstance instance) noexcept;
void init_diag_registry() noexcept;  // populates from getenv once

// === Tier B: invariant — argument unevaluated when disabled ===
[[noreturn]] void invariant_failed(const char* expr, const char* msg,
                                    const char* file, int line) noexcept;

}  // namespace gs::dbg

#if GSEURAT_DEBUG_BUILD
  #define GS_DBG_INVARIANT(cond, msg) \
    do { if (!(cond)) ::gs::dbg::invariant_failed(#cond, msg, __FILE__, __LINE__); } while (0)
  #define GS_LABEL_CONCAT_IMPL(a, b) a##b
  #define GS_LABEL_CONCAT(a, b) GS_LABEL_CONCAT_IMPL(a, b)
  #define GS_LABEL(cmd, name) \
    ::gs::dbg::ScopedLabel GS_LABEL_CONCAT(_gs_dbg_label_, __LINE__)((cmd), (name))
#else
  #define GS_DBG_INVARIANT(cond, msg) ((void)0)
  #define GS_LABEL(cmd, name) ((void)0)
#endif
