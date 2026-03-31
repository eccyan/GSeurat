#include "gseurat/engine/system_scheduler.hpp"
#include "gseurat/engine/ecs/world.hpp"

#include <cassert>
#include <cstdio>
#include <vector>

using namespace gseurat;

struct Position { float x = 0, y = 0; };
struct Velocity { float dx = 0, dy = 0; };

int main() {
    // 1. Systems run in order
    {
        std::vector<std::string> order;
        SystemScheduler sched;
        sched.add_system({"first", [&](ecs::World&, float) { order.push_back("first"); }, {}, {}});
        sched.add_system({"second", [&](ecs::World&, float) { order.push_back("second"); }, {}, {}});

        ecs::World world;
        sched.run_all(world, 0.016f);

        assert(order.size() == 2);
        assert(order[0] == "first");
        assert(order[1] == "second");
        std::printf("PASS: systems run in declared order\n");
    }

    // 2. Systems receive dt
    {
        float received_dt = 0;
        SystemScheduler sched;
        sched.add_system({"test", [&](ecs::World&, float dt) { received_dt = dt; }, {}, {}});

        ecs::World world;
        sched.run_all(world, 0.033f);
        assert(received_dt == 0.033f);
        std::printf("PASS: systems receive dt\n");
    }

    // 3. Systems can modify world
    {
        SystemScheduler sched;
        sched.add_system({"move", [](ecs::World& w, float dt) {
            w.view<Position, Velocity>().each([dt](ecs::Entity, Position& p, Velocity& v) {
                p.x += v.dx * dt;
                p.y += v.dy * dt;
            });
        }, {}, {}});

        ecs::World world;
        auto e = world.create();
        world.add<Position>(e, {0, 0});
        world.add<Velocity>(e, {10, 5});

        sched.run_all(world, 1.0f);

        assert(world.get<Position>(e).x == 10.0f);
        assert(world.get<Position>(e).y == 5.0f);
        std::printf("PASS: systems modify world\n");
    }

    // 4. Empty scheduler is safe
    {
        SystemScheduler sched;
        ecs::World world;
        sched.run_all(world, 0.016f);
        std::printf("PASS: empty scheduler runs without error\n");
    }

    std::printf("\nAll system scheduler tests passed.\n");
    return 0;
}
