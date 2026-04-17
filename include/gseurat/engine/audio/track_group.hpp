#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace gseurat::audio {

struct Marker {
    uint64_t    frame;
    std::string name;
};

struct StemMetadata {
    std::string source_path;
    float       initial_volume = 1.0f;
};

struct TrackGroupMetadata {
    uint32_t                  id;
    std::string               name;
    uint32_t                  sample_rate;
    uint64_t                  loop_start;
    uint64_t                  loop_end;
    std::vector<Marker>       markers;
    std::vector<StemMetadata> stems;
    float                     bpm = 0.0f;
};

}  // namespace gseurat::audio
