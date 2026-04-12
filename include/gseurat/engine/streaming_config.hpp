#pragma once

#include <cstdint>
#include <string>
#include <fstream>
#include <nlohmann/json.hpp>

namespace gseurat {

struct StreamingConfig {
    uint32_t gpu_budget_splats = 10'000'000;
    uint32_t slab_size_splats = 100'000;
    uint32_t transfer_budget_mb_per_frame = 4;

    uint32_t total_slabs() const { return gpu_budget_splats / slab_size_splats; }
    uint64_t total_bytes() const { return static_cast<uint64_t>(gpu_budget_splats) * 64; }
    uint64_t slab_bytes() const { return static_cast<uint64_t>(slab_size_splats) * 64; }

    static StreamingConfig load(const std::string& project_root) {
        StreamingConfig cfg;
        const auto path = project_root + "/engine_config.json";
        std::ifstream f(path);
        if (!f.is_open()) return cfg;
        try {
            nlohmann::json j;
            f >> j;
            if (j.contains("streaming")) {
                auto& s = j["streaming"];
                if (s.contains("gpu_budget_splats"))
                    cfg.gpu_budget_splats = s["gpu_budget_splats"].get<uint32_t>();
                if (s.contains("slab_size_splats"))
                    cfg.slab_size_splats = s["slab_size_splats"].get<uint32_t>();
                if (s.contains("transfer_budget_mb_per_frame"))
                    cfg.transfer_budget_mb_per_frame = s["transfer_budget_mb_per_frame"].get<uint32_t>();
            }
        } catch (...) {
            // Malformed config — use defaults
        }
        return cfg;
    }
};

}  // namespace gseurat
