#pragma once

#include "gseurat/engine/scene_loader.hpp"

#include <nlohmann/json.hpp>

namespace gseurat {

class AppBase;

struct GsSceneOptions {
    bool add_default_light = false;
    bool set_god_rays = false;
};

class GsSceneLoader {
public:
    explicit GsSceneLoader(AppBase& app) : app_(app) {}

    void load(const SceneData& scene_data, const GsSceneOptions& opts = {});

private:
    AppBase& app_;
};

}  // namespace gseurat
