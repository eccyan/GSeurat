#pragma once

#include "gseurat/engine/ecs/world.hpp"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace gseurat {

struct SystemDecl {
    std::string name;
    std::function<void(ecs::World&, float)> fn;
    std::vector<uint32_t> reads;   // component type IDs read (for future parallel scheduling)
    std::vector<uint32_t> writes;  // component type IDs written
};

class SystemScheduler {
public:
    void add_system(SystemDecl decl);
    void run_all(ecs::World& world, float dt);

    const std::vector<SystemDecl>& systems() const { return systems_; }

private:
    std::vector<SystemDecl> systems_;
};

}  // namespace gseurat
