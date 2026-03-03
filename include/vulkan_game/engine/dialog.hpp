#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace vulkan_game {

struct DialogLine {
    std::string speaker_key;
    std::string text_key;
};

struct DialogScript {
    std::vector<DialogLine> lines;
};

struct DialogState {
    bool active = false;
    const DialogScript* script = nullptr;
    size_t current_line = 0;

    void start(const DialogScript& s) {
        active = true;
        script = &s;
        current_line = 0;
    }

    bool advance() {
        if (!active || !script) return false;
        current_line++;
        if (current_line >= script->lines.size()) {
            active = false;
            script = nullptr;
            current_line = 0;
            return false;
        }
        return true;
    }

    const DialogLine& current() const {
        return script->lines[current_line];
    }
};

}  // namespace vulkan_game
