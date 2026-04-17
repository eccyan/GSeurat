#pragma once
#include "gseurat/engine/audio/track_group.hpp"
#include <expected>
#include <string_view>
#include <vector>

namespace gseurat::audio {

struct MusicConfig {
    uint32_t                        sample_rate;
    std::vector<TrackGroupMetadata> track_groups;
};

enum class MetadataError : uint32_t {
    FileNotFound,
    ParseFailed,
    BadVersion,
    MarkersNotAscending,
    MissingRequiredField,
    BadValue,
};

std::expected<MusicConfig, MetadataError>
parse_music_config_json(std::string_view json_text);

std::expected<MusicConfig, MetadataError>
load_music_config(std::string_view path);

}  // namespace gseurat::audio
