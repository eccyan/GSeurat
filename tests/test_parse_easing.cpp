// Test: parse_easing — string to GsEasing enum conversion.
// Build: add_gseurat_test(test_parse_easing src/engine/gs_animator.cpp)

#include "gseurat/engine/gs_animator.hpp"

#include <cstdio>

static int passed = 0;
static int failed = 0;

static void check(bool cond, const char* msg) {
    if (cond) { std::printf("  PASS: %s\n", msg); passed++; }
    else      { std::printf("  FAIL: %s\n", msg); failed++; }
}

void test_known_easings() {
    std::printf("Known easings:\n");
    using namespace gseurat;
    check(parse_easing("linear") == GsEasing::Linear, "linear");
    check(parse_easing("in_quad") == GsEasing::InQuad, "in_quad");
    check(parse_easing("ease_in") == GsEasing::InQuad, "ease_in alias");
    check(parse_easing("out_quad") == GsEasing::OutQuad, "out_quad");
    check(parse_easing("ease_out") == GsEasing::OutQuad, "ease_out alias");
    check(parse_easing("in_out_quad") == GsEasing::InOutQuad, "in_out_quad");
    check(parse_easing("ease_in_out") == GsEasing::InOutQuad, "ease_in_out alias");
    check(parse_easing("in_elastic") == GsEasing::InElastic, "in_elastic");
    check(parse_easing("out_bounce") == GsEasing::OutBounce, "out_bounce");
}

void test_unknown_fallback() {
    std::printf("Unknown fallback:\n");
    using namespace gseurat;
    check(parse_easing("nonexistent") == GsEasing::Linear, "unknown -> Linear");
    check(parse_easing("") == GsEasing::Linear, "empty -> Linear");
}

int main() {
    std::printf("=== parse_easing Tests ===\n\n");
    test_known_easings();
    test_unknown_fallback();
    std::printf("\n=== Results: %d passed, %d failed ===\n", passed, failed);
    return failed > 0 ? 1 : 0;
}
