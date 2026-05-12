// src/engine/log.cpp
#include "gseurat/engine/log.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>

namespace gs::log {

namespace {

std::array<bool, static_cast<std::size_t>(Category::COUNT_)> g_enabled{};
std::FILE* g_sink = nullptr;
bool g_sink_owned = false;
std::mutex g_mutex;

constexpr const char* env_var_for(Category c) noexcept {
  switch (c) {
    case Category::Frame:  return "GS_LOG_FRAME";
    case Category::COUNT_: break;
  }
  return "";
}

}  // namespace

bool enabled(Category c) noexcept {
  const auto idx = static_cast<std::size_t>(c);
  return idx < g_enabled.size() && g_enabled[idx];
}

void logf_impl(Level /*lvl*/, Category /*cat*/, std::string_view fmt,
               std::format_args args) noexcept {
  try {
    std::string line = std::vformat(fmt, args);
    std::lock_guard<std::mutex> lk(g_mutex);
    std::FILE* sink = g_sink ? g_sink : stderr;
    std::fwrite(line.data(), 1, line.size(), sink);
    std::fputc('\n', sink);
  } catch (...) {
    // Logging must never throw out of a callee. Swallow formatting errors.
  }
}

void init_log() noexcept {
  for (std::size_t i = 0; i < g_enabled.size(); ++i) {
    const char* var = env_var_for(static_cast<Category>(i));
    if (var[0] == '\0') continue;
    const char* val = std::getenv(var);
    g_enabled[i] = (val && val[0] == '1');
  }

  // Sink selection — env var redirects to a file (append mode). On open
  // failure we silently fall back to stderr; logging must not fail loudly.
  const char* sink_path = std::getenv("GS_LOG_SINK");
  if (sink_path && sink_path[0] != '\0') {
    std::FILE* f = std::fopen(sink_path, "ab");
    if (f) {
      std::lock_guard<std::mutex> lk(g_mutex);
      g_sink = f;
      g_sink_owned = true;
      return;
    }
  }
  std::lock_guard<std::mutex> lk(g_mutex);
  g_sink = stderr;
  g_sink_owned = false;
}

void shutdown_log() noexcept {
  std::lock_guard<std::mutex> lk(g_mutex);
  if (g_sink_owned && g_sink) {
    std::fclose(g_sink);
  }
  g_sink = nullptr;
  g_sink_owned = false;
}

}  // namespace gs::log
