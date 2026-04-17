#include "metadata_loader.hpp"
#include <nlohmann/json.hpp>
#include <fstream>
#include <sstream>

namespace gseurat::audio {
using nlohmann::json;

std::expected<MusicConfig, MetadataError>
parse_music_config_json(std::string_view text) {
    json j;
    try { j = json::parse(text); }
    catch (...) { return std::unexpected(MetadataError::ParseFailed); }

    if (!j.contains("version") || !j["version"].is_number_integer()
        || j["version"].get<int>() != 2)
        return std::unexpected(MetadataError::BadVersion);
    if (!j.contains("sample_rate") || !j.contains("track_groups"))
        return std::unexpected(MetadataError::MissingRequiredField);

    MusicConfig cfg;
    cfg.sample_rate = j["sample_rate"].get<uint32_t>();

    for (const auto& tgj : j["track_groups"]) {
        TrackGroupMetadata tg;
        tg.id          = tgj.at("id").get<uint32_t>();
        tg.name        = tgj.at("name").get<std::string>();
        tg.sample_rate = cfg.sample_rate;
        tg.loop_start  = tgj.value("loop_start", uint64_t{0});
        tg.loop_end    = tgj.value("loop_end",   uint64_t{0});
        tg.bpm         = tgj.value("bpm",        0.0f);

        if (tgj.contains("markers")) {
            uint64_t prev = 0;
            bool first = true;
            for (const auto& mj : tgj["markers"]) {
                Marker m;
                m.frame = mj.at("frame").get<uint64_t>();
                m.name  = mj.value("name", std::string{});
                if (!first && m.frame <= prev)
                    return std::unexpected(MetadataError::MarkersNotAscending);
                prev = m.frame; first = false;
                tg.markers.push_back(std::move(m));
            }
        }

        for (const auto& sj : tgj.at("stems")) {
            StemMetadata s;
            s.source_path    = sj.at("source").get<std::string>();
            s.initial_volume = sj.value("initial_volume", 1.0f);
            tg.stems.push_back(std::move(s));
        }
        cfg.track_groups.push_back(std::move(tg));
    }
    return cfg;
}

std::expected<MusicConfig, MetadataError>
load_music_config(std::string_view path) {
    std::ifstream f{std::string(path)};
    if (!f) return std::unexpected(MetadataError::FileNotFound);
    std::stringstream ss;
    ss << f.rdbuf();
    return parse_music_config_json(ss.str());
}

}  // namespace gseurat::audio
