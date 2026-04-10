#include "gseurat/engine/project_root.hpp"

namespace gseurat {

namespace {
// Anonymous-namespace global so it has internal linkage. The single-thread
// ControlServer dispatch is the only writer; readers (SceneLoader, etc.)
// are called on the same thread, so no synchronization is needed.
std::string g_project_root;
} // namespace

void set_project_root(const std::string& path) {
    g_project_root = path;
}

const std::string& get_project_root() {
    return g_project_root;
}

std::filesystem::path resolve_asset_path(const std::string& relative_or_abs) {
    if (relative_or_abs.empty()) return std::filesystem::path{};
    std::filesystem::path p(relative_or_abs);
    if (p.is_absolute()) return p;
    if (!g_project_root.empty()) {
        return std::filesystem::path(g_project_root) / p;
    }
    return p;
}

} // namespace gseurat
