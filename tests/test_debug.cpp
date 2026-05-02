// tests/test_debug.cpp
#include "gseurat/engine/debug.hpp"

#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <string>

int main() {
  auto set_env = [](const char* name, const char* value) {
#ifdef _WIN32
    std::string assignment(name);
    assignment += "=";
    assignment += value;
    _putenv(assignment.c_str());
#else
    setenv(name, value, 1);
#endif
  };
  auto unset_env = [](const char* name) {
#ifdef _WIN32
    std::string assignment(name);
    assignment += "=";
    _putenv(assignment.c_str());
#else
    unsetenv(name);
#endif
  };

  // Default: no diag flags set
  unset_env("GS_DIAG_STREAMING");
  unset_env("GS_DIAG_GPU_TIMING");
  gs::dbg::init_diag_registry();
  assert(!gs::dbg::enabled(gs::dbg::Diag::StreamingState));
  assert(!gs::dbg::enabled(gs::dbg::Diag::GpuTiming));

  // Set env var, re-init, verify flag flips
  set_env("GS_DIAG_STREAMING", "1");
  gs::dbg::init_diag_registry();
  assert(gs::dbg::enabled(gs::dbg::Diag::StreamingState));
  assert(!gs::dbg::enabled(gs::dbg::Diag::GpuTiming));

  // "0" should be off, only "1" enables
  set_env("GS_DIAG_STREAMING", "0");
  gs::dbg::init_diag_registry();
  assert(!gs::dbg::enabled(gs::dbg::Diag::StreamingState));

  std::printf("test_debug: OK\n");
  return 0;
}
