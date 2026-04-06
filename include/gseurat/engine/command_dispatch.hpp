#pragma once

#include <expected>
#include <functional>
#include <string>
#include <unordered_map>

#include <nlohmann/json_fwd.hpp>

namespace gseurat {

// CommandResult: std::expected — success carries the JSON response,
// failure carries an error message string.
using CommandResult = std::expected<nlohmann::json, std::string>;

// std::move_only_function when compiler supports P1288R9; std::function for now.
using CommandHandler = std::function<CommandResult(const nlohmann::json&)>;

using CommandTable = std::unordered_map<std::string, CommandHandler>;

}  // namespace gseurat
