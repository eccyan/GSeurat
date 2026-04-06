#pragma once

#include "gseurat/engine/scene_loader.hpp"

namespace gseurat {

struct SceneLoadContext;

struct GsSceneOptions {
    bool add_default_light = false;
    bool set_god_rays = false;
};

class GsSceneLoader {
public:
    void load(SceneLoadContext& ctx, const SceneData& scene_data,
              const GsSceneOptions& opts = {});
};

}  // namespace gseurat
