// tests/test_random.cpp
#include "gseurat/engine/random.hpp"
#include <cassert>
#include <cstdio>
#include <vector>

int main() {
  // Same seed → identical sequence
  gs::random::seed(42);
  std::vector<float> a;
  for (int i = 0; i < 100; ++i) a.push_back(gs::random::next_float());

  gs::random::seed(42);
  std::vector<float> b;
  for (int i = 0; i < 100; ++i) b.push_back(gs::random::next_float());

  for (size_t i = 0; i < a.size(); ++i) {
    assert(a[i] == b[i]);  // bit-exact
  }

  // Different seed → different sequence (statistically)
  gs::random::seed(43);
  std::vector<float> c;
  for (int i = 0; i < 100; ++i) c.push_back(gs::random::next_float());
  bool any_differ = false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (a[i] != c[i]) { any_differ = true; break; }
  }
  assert(any_differ);

  std::printf("test_random: OK\n");
  return 0;
}
