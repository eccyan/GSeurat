#pragma once

#include <memory>
#include <vector>

namespace gseurat {

class AppBase;

class GameState {
public:
    virtual ~GameState() = default;

    virtual void on_enter(AppBase& app) { (void)app; }
    virtual void on_exit(AppBase& app) { (void)app; }
    virtual void update(AppBase& app, float dt) = 0;
    virtual void build_draw_lists(AppBase& app) { (void)app; }
    virtual bool is_overlay() const { return false; }
};

class GameStateStack {
public:
    void push(std::unique_ptr<GameState> state, AppBase& app);
    void pop(AppBase& app);
    void replace(std::unique_ptr<GameState> state, AppBase& app);

    void update(AppBase& app, float dt);
    void build_draw_lists(AppBase& app);

    bool empty() const { return stack_.empty(); }
    GameState* top() const;

private:
    std::vector<std::unique_ptr<GameState>> stack_;
};

}  // namespace gseurat
