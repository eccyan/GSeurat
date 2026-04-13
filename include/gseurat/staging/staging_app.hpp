#pragma once
#include "gseurat/engine/app_base.hpp"
#include <string>

namespace gseurat {
class StagingApp : public AppBase {
public:
    void parse_args(int argc, char* argv[]);
    void run() override;
protected:
    void init_game_content() override;
    void init_scene(const std::string& scene_path) override;
    void clear_scene() override;
private:
    std::string scene_path_;
};
}  // namespace gseurat
