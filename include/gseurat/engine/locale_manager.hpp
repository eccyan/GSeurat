#pragma once

#include <string>
#include <unordered_map>
#include <vector>

namespace gseurat {

class LocaleManager {
public:
    void load(const std::string& locale_dir, const std::string& locale_name);
    const std::string& get(const std::string& key) const;
    std::vector<std::string> all_strings() const;
    const std::string& current_locale() const { return current_locale_; }

private:
    std::unordered_map<std::string, std::string> strings_;
    std::string current_locale_;
    std::string missing_string_{"???"};
};

}  // namespace gseurat
