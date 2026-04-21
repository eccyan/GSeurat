#pragma once

#include <expected>
#include <functional>
#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

#include "gseurat/engine/command_context.hpp"

namespace gseurat {

// ── C++23 Command Pattern types ──

// Success carries the JSON response, failure carries an error message.
using CommandResult = std::expected<nlohmann::json, std::string>;

// std::move_only_function when compiler supports P1288R9; std::function for now.
using CommandHandler = std::function<CommandResult(const nlohmann::json&)>;

// ── CommandDispatcher ──
// Self-contained dispatcher that holds a CommandContext with references to subsystems.
// All command handlers are registered as lambdas and looked up by name.

class CommandDispatcher {
public:
    explicit CommandDispatcher(CommandContext ctx) : ctx_(std::move(ctx)) {}

    void register_command(std::string name, CommandHandler handler);
    void register_default_commands();
    void dispatch(const nlohmann::json& cmd, nlohmann::json& response);

    CommandContext& context() { return ctx_; }
    const CommandContext& context() const { return ctx_; }

private:
    CommandContext ctx_;
    std::unordered_map<std::string, CommandHandler> handlers_;
};

}  // namespace gseurat
