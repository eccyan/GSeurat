#pragma once

#include <filesystem>
#include <string>

namespace gseurat {

/// Set the global project root path. Pass empty string to clear (back-compat
/// with CWD-relative behavior).
void set_project_root(const std::string& path);

/// Returns the current project root, or empty string if not set.
const std::string& get_project_root();

/// Resolve a path the engine reads from disk:
/// - If `relative_or_abs` is absolute, returns it unchanged.
/// - If a project root is set and `relative_or_abs` is relative, returns
///   project_root / relative_or_abs.
/// - Otherwise (no project root set), returns `relative_or_abs` unchanged.
///
/// This makes engine asset reads work both standalone (CWD-relative, the
/// pre-Phase-0.0 behavior) and under a user-picked project root supplied
/// via the bridge's POST /api/project/root endpoint.
std::filesystem::path resolve_asset_path(const std::string& relative_or_abs);

} // namespace gseurat
