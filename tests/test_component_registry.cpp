#include "gseurat/engine/component_registry.hpp"
#include "gseurat/engine/ecs/world.hpp"

#include <cassert>
#include <cstdio>

using namespace gseurat;

struct Health {
    float max_hp = 100.f;
    float current_hp = 100.f;
};

struct Interactable {
    std::string prompt = "Interact";
    float radius = 2.0f;
    bool one_shot = false;
};

int main() {
    // 1. Register components
    {
        ComponentRegistry reg;
        reg.register_component<Health>("Health",
            [](const nlohmann::json& j) -> Health {
                Health h;
                if (j.contains("max_hp")) h.max_hp = j["max_hp"].get<float>();
                if (j.contains("current_hp")) h.current_hp = j["current_hp"].get<float>();
                return h;
            },
            [](const Health& h) -> nlohmann::json {
                return {{"max_hp", h.max_hp}, {"current_hp", h.current_hp}};
            });

        auto names = reg.registered_names();
        assert(names.size() == 1);
        assert(names[0] == "Health");
        std::printf("PASS: register_component and registered_names\n");
    }

    // 2. Attach component from JSON to ECS entity
    {
        ComponentRegistry reg;
        reg.register_component<Health>("Health",
            [](const nlohmann::json& j) -> Health {
                Health h;
                if (j.contains("max_hp")) h.max_hp = j["max_hp"].get<float>();
                if (j.contains("current_hp")) h.current_hp = j["current_hp"].get<float>();
                return h;
            },
            [](const Health& h) -> nlohmann::json {
                return {{"max_hp", h.max_hp}, {"current_hp", h.current_hp}};
            });

        ecs::World world;
        auto entity = world.create();
        nlohmann::json data = {{"max_hp", 50.0f}, {"current_hp", 30.0f}};
        reg.attach(world, entity, "Health", data);

        auto* h = world.try_get<Health>(entity);
        assert(h != nullptr);
        assert(h->max_hp == 50.0f);
        assert(h->current_hp == 30.0f);
        std::printf("PASS: attach component from JSON\n");
    }

    // 3. Serialize component back to JSON
    {
        ComponentRegistry reg;
        reg.register_component<Health>("Health",
            [](const nlohmann::json& j) -> Health {
                Health h;
                if (j.contains("max_hp")) h.max_hp = j["max_hp"].get<float>();
                if (j.contains("current_hp")) h.current_hp = j["current_hp"].get<float>();
                return h;
            },
            [](const Health& h) -> nlohmann::json {
                return {{"max_hp", h.max_hp}, {"current_hp", h.current_hp}};
            });

        ecs::World world;
        auto entity = world.create();
        world.add<Health>(entity, {75.0f, 50.0f});

        auto j = reg.serialize(world, entity, "Health");
        assert(j["max_hp"].get<float>() == 75.0f);
        assert(j["current_hp"].get<float>() == 50.0f);
        std::printf("PASS: serialize component to JSON\n");
    }

    // 4. Multiple component types
    {
        ComponentRegistry reg;
        reg.register_component<Health>("Health",
            [](const nlohmann::json& j) -> Health {
                Health h;
                if (j.contains("max_hp")) h.max_hp = j["max_hp"].get<float>();
                if (j.contains("current_hp")) h.current_hp = j["current_hp"].get<float>();
                return h;
            },
            [](const Health& h) -> nlohmann::json {
                return {{"max_hp", h.max_hp}, {"current_hp", h.current_hp}};
            });
        reg.register_component<Interactable>("Interactable",
            [](const nlohmann::json& j) -> Interactable {
                Interactable i;
                if (j.contains("prompt")) i.prompt = j["prompt"].get<std::string>();
                if (j.contains("radius")) i.radius = j["radius"].get<float>();
                if (j.contains("one_shot")) i.one_shot = j["one_shot"].get<bool>();
                return i;
            },
            [](const Interactable& i) -> nlohmann::json {
                return {{"prompt", i.prompt}, {"radius", i.radius}, {"one_shot", i.one_shot}};
            });

        ecs::World world;
        auto entity = world.create();
        reg.attach(world, entity, "Health", {{"max_hp", 200}});
        reg.attach(world, entity, "Interactable", {{"prompt", "Open"}, {"radius", 3.0f}});

        assert(world.try_get<Health>(entity)->max_hp == 200.0f);
        assert(world.try_get<Interactable>(entity)->prompt == "Open");
        assert(world.try_get<Interactable>(entity)->radius == 3.0f);

        auto names = reg.registered_names();
        assert(names.size() == 2);
        std::printf("PASS: multiple component types on one entity\n");
    }

    // 5. Attach unknown component name is no-op
    {
        ComponentRegistry reg;
        ecs::World world;
        auto entity = world.create();
        reg.attach(world, entity, "Nonexistent", {});
        std::printf("PASS: unknown component name is no-op\n");
    }

    std::printf("\nAll component registry tests passed.\n");
    return 0;
}
