#include "metadata_loader.hpp"
#include <cstdio>
using namespace gseurat::audio;

static int passed = 0, failed = 0;
static void check(bool c, const char* m) {
    if (c) { std::printf("  PASS: %s\n", m); ++passed; }
    else   { std::printf("  FAIL: %s\n", m); ++failed; }
}

int main() {
    std::printf("\n=== Metadata Loader Tests ===\n\n");

    // --- Load fixture ---
    auto r = load_music_config("../../tests/test_data/audio/sine_loop.json");
    check(r.has_value(), "load sine_loop.json");
    if (!r) { std::printf("  ERROR: %u\n", static_cast<unsigned>(r.error())); return 1; }
    auto& cfg = r.value();
    check(cfg.sample_rate == 48000, "sample_rate=48000");
    check(cfg.track_groups.size() == 1, "1 track group");
    const auto& tg = cfg.track_groups[0];
    check(tg.id == 1, "id=1");
    check(tg.name == "sine_loop", "name=sine_loop");
    check(tg.loop_end == 24000, "loop_end=24000");
    check(tg.markers.size() == 1, "1 marker");
    check(tg.markers[0].frame == 12000, "marker frame=12000");
    check(tg.stems.size() == 1, "1 stem");

    // --- Reject non-ascending markers ---
    auto bad = parse_music_config_json(R"({
        "version": 2, "sample_rate": 48000,
        "track_groups": [{"id":1,"name":"x","markers":[{"frame":100},{"frame":50}],
                          "stems":[{"source":"x.wav"}]}]
    })");
    check(!bad.has_value(), "non-ascending markers rejected");

    // --- Reject wrong version ---
    auto badv = parse_music_config_json(R"({"version":1,"sample_rate":48000,"track_groups":[]})");
    check(!badv.has_value(), "version != 2 rejected");

    std::printf("\n=== %d passed, %d failed ===\n", passed, failed);
    return failed == 0 ? 0 : 1;
}
