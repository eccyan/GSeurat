// include/gseurat/engine/log.hpp
//
// Structured engine logging — replaces the ad-hoc
// `#if GSEURAT_DEBUG_BUILD + if (Diag::Watchdog) + fprintf(stderr,...)` pattern
// that scattered through the frame-hot paths and caused pipe-fill deadlocks
// when the regression harness captured stderr via subprocess.PIPE.
//
// Pattern:
//   GS_LOG_FRAME("[loop/wd] iter_start tick={}", tick_);   // std::format-style
//
// Compile-time: the macro expands to ((void)0) outside GSEURAT_DEBUG_BUILD.
// Runtime:      env GS_LOG_FRAME=1 enables Category::Frame at startup.
// Sink:         default stderr; env GS_LOG_SINK=/path redirects to a file.
#pragma once

#include <cstdint>
#include <format>
#include <string_view>
#include <utility>

#ifndef GSEURAT_DEBUG_BUILD
#  define GSEURAT_DEBUG_BUILD 0
#endif

namespace gs::log {

enum class Category : std::uint8_t {
  Frame,   // per-frame watchdog traces (env: GS_LOG_FRAME=1)
  COUNT_
};

enum class Level : std::uint8_t { Trace, Info, Warn, Error };

bool enabled(Category) noexcept;

// Non-template impl lives in log.cpp so callers don't drag <format>'s
// instantiations through every TU more than necessary.
void logf_impl(Level, Category, std::string_view fmt,
               std::format_args args) noexcept;

template <typename... Args>
inline void logf(Level lvl, Category cat,
                 std::format_string<Args...> fmt, Args&&... args) noexcept {
  if (!enabled(cat)) return;
  logf_impl(lvl, cat, fmt.get(),
            std::make_format_args(args...));
}

// Lifecycle — call once at startup (alongside gs::dbg::init_diag_registry)
// and once at shutdown. Both are idempotent.
void init_log() noexcept;
void shutdown_log() noexcept;

}  // namespace gs::log

#if GSEURAT_DEBUG_BUILD
  #define GS_LOG_FRAME(...) \
    ::gs::log::logf(::gs::log::Level::Trace, ::gs::log::Category::Frame, __VA_ARGS__)
#else
  #define GS_LOG_FRAME(...) ((void)0)
#endif
