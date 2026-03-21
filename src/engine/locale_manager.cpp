#include "gseurat/engine/locale_manager.hpp"

#include <fstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace gseurat {

void LocaleManager::load(const std::string& locale_dir, const std::string& locale_name) {
    std::string path = locale_dir + "/" + locale_name + ".json";
    std::ifstream file(path);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open locale file: " + path);
    }

    auto json = nlohmann::json::parse(file);
    strings_.clear();
    for (auto& [key, value] : json.items()) {
        if (value.is_string()) {
            strings_[key] = value.get<std::string>();
        }
    }
    current_locale_ = locale_name;
}

const std::string& LocaleManager::get(const std::string& key) const {
    auto it = strings_.find(key);
    if (it != strings_.end()) {
        return it->second;
    }
    return missing_string_;
}

std::vector<std::string> LocaleManager::all_strings() const {
    std::vector<std::string> result;
    result.reserve(strings_.size());
    for (const auto& [key, value] : strings_) {
        result.push_back(value);
    }
    return result;
}

}  // namespace gseurat
