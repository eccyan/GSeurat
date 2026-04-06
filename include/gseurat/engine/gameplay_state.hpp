#pragma once

#include "gseurat/engine/dialog.hpp"

#include <string>
#include <unordered_map>
#include <vector>

namespace gseurat {

struct GameplayState {
    enum class Mode { Explore, Dialog };
    Mode mode = Mode::Explore;
    DialogState dialog;
    std::vector<DialogScript> npc_dialogs;
    std::unordered_map<std::string, bool> flags;
    float play_time = 0.0f;
};

}  // namespace gseurat
