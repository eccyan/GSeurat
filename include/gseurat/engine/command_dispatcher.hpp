#pragma once

#include <expected>
#include <functional>
#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

namespace gseurat {

class AppBase;  // forward declaration

// ── C++23 Command Pattern types ──

// Success carries the JSON response, failure carries an error message.
using CommandResult = std::expected<nlohmann::json, std::string>;

// std::move_only_function when compiler supports P1288R9; std::function for now.
using CommandHandler = std::function<CommandResult(const nlohmann::json&)>;

// ── CommandDispatcher ──
// Self-contained dispatcher that holds a reference to AppBase.
// All command handlers are registered as lambdas and looked up by name.

class CommandDispatcher {
public:
    explicit CommandDispatcher(AppBase& app) : app_(app) {}

    void register_command(std::string name, CommandHandler handler);
    void register_default_commands();
    void dispatch(const nlohmann::json& cmd, nlohmann::json& response);

private:
    AppBase& app_;
    std::unordered_map<std::string, CommandHandler> handlers_;
};

}  // namespace gseurat
