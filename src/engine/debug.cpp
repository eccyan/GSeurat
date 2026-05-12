// src/engine/debug.cpp
#include "gseurat/engine/debug.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace gs::dbg {

namespace {

PFN_vkCmdBeginDebugUtilsLabelEXT  g_begin_label = nullptr;
PFN_vkCmdEndDebugUtilsLabelEXT    g_end_label   = nullptr;
PFN_vkSetDebugUtilsObjectNameEXT  g_set_name    = nullptr;

std::array<bool, static_cast<std::size_t>(Diag::COUNT_)> g_diag_flags{};

constexpr const char* env_var_for(Diag d) noexcept {
  switch (d) {
    case Diag::StreamingState:   return "GS_DIAG_STREAMING";
    case Diag::GpuTiming:        return "GS_DIAG_GPU_TIMING";
    case Diag::ChunkInventory:   return "GS_DIAG_CHUNKS";
    case Diag::RenderStateSlots: return "GS_DIAG_RENDERSTATE";
    case Diag::EventQueueSizes:  return "GS_DIAG_EVENTS";
    case Diag::Watchdog:         return "GS_DIAG_WATCHDOG";
    case Diag::COUNT_:           break;
  }
  return "";
}

}  // namespace

ScopedLabel::ScopedLabel(VkCommandBuffer cmd, const char* name, glm::vec4 color) noexcept
    : cmd_(cmd) {
  if constexpr (kEnabled) {
    if (g_begin_label) {
      VkDebugUtilsLabelEXT label{};
      label.sType      = VK_STRUCTURE_TYPE_DEBUG_UTILS_LABEL_EXT;
      label.pLabelName = name;
      label.color[0]   = color.r;
      label.color[1]   = color.g;
      label.color[2]   = color.b;
      label.color[3]   = color.a;
      g_begin_label(cmd_, &label);
    }
  }
}

ScopedLabel::~ScopedLabel() noexcept {
  if constexpr (kEnabled) {
    if (g_end_label) g_end_label(cmd_);
  }
}

void set_object_name(VkDevice device, VkObjectType type,
                     std::uint64_t handle, const char* name) noexcept {
  if constexpr (kEnabled) {
    if (g_set_name) {
      VkDebugUtilsObjectNameInfoEXT info{};
      info.sType        = VK_STRUCTURE_TYPE_DEBUG_UTILS_OBJECT_NAME_INFO_EXT;
      info.objectType   = type;
      info.objectHandle = handle;
      info.pObjectName  = name;
      g_set_name(device, &info);
    }
  }
}

bool enabled(Diag d) noexcept {
  const auto idx = static_cast<std::size_t>(d);
  return idx < g_diag_flags.size() && g_diag_flags[idx];
}

void init_function_pointers(VkInstance instance) noexcept {
  if constexpr (kEnabled) {
    g_begin_label = reinterpret_cast<PFN_vkCmdBeginDebugUtilsLabelEXT>(
        vkGetInstanceProcAddr(instance, "vkCmdBeginDebugUtilsLabelEXT"));
    g_end_label = reinterpret_cast<PFN_vkCmdEndDebugUtilsLabelEXT>(
        vkGetInstanceProcAddr(instance, "vkCmdEndDebugUtilsLabelEXT"));
    g_set_name = reinterpret_cast<PFN_vkSetDebugUtilsObjectNameEXT>(
        vkGetInstanceProcAddr(instance, "vkSetDebugUtilsObjectNameEXT"));
  }
}

void init_diag_registry() noexcept {
  for (std::size_t i = 0; i < g_diag_flags.size(); ++i) {
    const char* var = env_var_for(static_cast<Diag>(i));
    if (var[0] == '\0') continue;
    const char* val = std::getenv(var);
    g_diag_flags[i] = (val && val[0] == '1');
  }
}

[[noreturn]] void invariant_failed(const char* expr, const char* msg,
                                    const char* file, int line) noexcept {
  std::fprintf(stderr, "[gs::dbg INVARIANT FAILED] %s\n  expr: %s\n  at: %s:%d\n",
               msg, expr, file, line);
  std::abort();
}

}  // namespace gs::dbg
