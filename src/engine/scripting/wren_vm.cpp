#include "gseurat/engine/scripting/wren_vm.hpp"
#include "gseurat/engine/app_base.hpp"

#include <chrono>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace gseurat {

WrenVM::~WrenVM() {
    shutdown();
}

void WrenVM::init(AppBase* app) {
    app_ = app;

    WrenConfiguration config;
    wrenInitConfiguration(&config);
    config.writeFn = &WrenVM::write_fn;
    config.errorFn = &WrenVM::error_fn;
    config.bindForeignMethodFn = &WrenVM::bind_foreign_method_fn;
    config.loadModuleFn = &WrenVM::load_module_fn;
    config.userData = this;

    vm_ = wrenNewVM(&config);
}

void WrenVM::shutdown() {
    if (!vm_) return;

    for (auto& [key, handle] : call_handles_) {
        wrenReleaseHandle(vm_, handle);
    }
    call_handles_.clear();

    for (auto& [key, handle] : class_handles_) {
        wrenReleaseHandle(vm_, handle);
    }
    class_handles_.clear();

    wrenFreeVM(vm_);
    vm_ = nullptr;
}

bool WrenVM::load_module(const std::string& module_name, const std::string& path) {
    // Skip if this module has already been compiled in the VM.
    if (modules_.contains(module_name) && !modules_[module_name].source.empty()) {
        return true;
    }

    std::ifstream file(path);
    if (!file.is_open()) {
        std::fprintf(stderr, "WrenVM: failed to open %s\n", path.c_str());
        return false;
    }

    std::stringstream ss;
    ss << file.rdbuf();
    std::string source = ss.str();

    register_module_path(module_name, path);
    modules_[module_name].source = source;

    return interpret(module_name, source);
}

bool WrenVM::interpret(const std::string& module_name, const std::string& source) {
    WrenInterpretResult result = wrenInterpret(vm_, module_name.c_str(), source.c_str());
    if (result != WREN_RESULT_SUCCESS) {
        std::fprintf(stderr, "WrenVM: failed to interpret module '%s'\n", module_name.c_str());
        return false;
    }
    return true;
}

bool WrenVM::call_method(const std::string& module_name,
                         const std::string& class_name,
                         const std::string& signature) {
    WrenHandle* class_handle = get_or_create_class_handle(module_name, class_name);
    if (!class_handle) return false;

    WrenHandle* method_handle = get_or_create_call_handle(signature);
    if (!method_handle) return false;

    wrenEnsureSlots(vm_, 1);
    wrenSetSlotHandle(vm_, 0, class_handle);

    WrenInterpretResult result = wrenCall(vm_, method_handle);
    return result == WREN_RESULT_SUCCESS;
}

void WrenVM::register_module_path(const std::string& module_name, const std::string& path) {
    auto& info = modules_[module_name];
    info.path = path;

    // Record last modified time.
    try {
        auto ftime = std::filesystem::last_write_time(path);
        info.last_modified = ftime.time_since_epoch().count();
    } catch (...) {
        info.last_modified = 0;
    }
}

void WrenVM::check_hot_reload() {
    for (auto& [name, info] : modules_) {
        if (info.path.empty()) continue;

        try {
            auto ftime = std::filesystem::last_write_time(info.path);
            long long current = ftime.time_since_epoch().count();
            if (current != info.last_modified) {
                info.last_modified = current;

                std::ifstream file(info.path);
                if (!file.is_open()) continue;

                std::stringstream ss;
                ss << file.rdbuf();
                std::string new_source = ss.str();

                if (new_source != info.source) {
                    std::fprintf(stderr, "WrenVM: hot-reloading module '%s'\n", name.c_str());
                    info.source = new_source;

                    // Release cached class handles for this module (they may be stale).
                    auto it = class_handles_.find(name);
                    if (it != class_handles_.end()) {
                        wrenReleaseHandle(vm_, it->second);
                        class_handles_.erase(it);
                    }

                    wrenInterpret(vm_, name.c_str(), new_source.c_str());
                }
            }
        } catch (...) {
            // Filesystem error — skip this module.
        }
    }
}

WrenHandle* WrenVM::get_or_create_call_handle(const std::string& signature) {
    auto it = call_handles_.find(signature);
    if (it != call_handles_.end()) return it->second;

    WrenHandle* handle = wrenMakeCallHandle(vm_, signature.c_str());
    if (handle) {
        call_handles_[signature] = handle;
    }
    return handle;
}

WrenHandle* WrenVM::get_or_create_class_handle(const std::string& module_name,
                                                 const std::string& class_name) {
    // Use module::class as key.
    std::string key = module_name + "::" + class_name;
    auto it = class_handles_.find(key);
    if (it != class_handles_.end()) return it->second;

    wrenEnsureSlots(vm_, 1);
    wrenGetVariable(vm_, module_name.c_str(), class_name.c_str(), 0);
    WrenHandle* handle = wrenGetSlotHandle(vm_, 0);
    if (handle) {
        class_handles_[key] = handle;
    }
    return handle;
}

// Static callbacks.

void WrenVM::write_fn(::WrenVM* /*vm*/, const char* text) {
    std::printf("%s", text);
}

void WrenVM::error_fn(::WrenVM* /*vm*/, WrenErrorType type,
                       const char* module, int line, const char* message) {
    switch (type) {
        case WREN_ERROR_COMPILE:
            std::fprintf(stderr, "[wren compile error] %s:%d: %s\n", module, line, message);
            break;
        case WREN_ERROR_RUNTIME:
            std::fprintf(stderr, "[wren runtime error] %s\n", message);
            break;
        case WREN_ERROR_STACK_TRACE:
            std::fprintf(stderr, "  at %s:%d in %s\n", module, line, message);
            break;
    }
}

WrenForeignMethodFn WrenVM::bind_foreign_method_fn(
    ::WrenVM* vm, const char* module, const char* className,
    bool isStatic, const char* signature) {
    auto* wrapper = static_cast<WrenVM*>(wrenGetUserData(vm));
    if (wrapper && wrapper->bind_foreign_method_cb_) {
        return wrapper->bind_foreign_method_cb_(module, className, isStatic, signature);
    }
    return nullptr;
}

WrenLoadModuleResult WrenVM::load_module_fn(::WrenVM* vm, const char* name) {
    WrenLoadModuleResult result{};
    auto* wrapper = static_cast<WrenVM*>(wrenGetUserData(vm));
    if (!wrapper) return result;

    // Check if we have the source cached.
    auto it = wrapper->modules_.find(name);
    if (it != wrapper->modules_.end() && !it->second.source.empty()) {
        // Wren expects a heap-allocated string it will free.
        char* source = static_cast<char*>(std::malloc(it->second.source.size() + 1));
        std::memcpy(source, it->second.source.c_str(), it->second.source.size() + 1);
        result.source = source;
        return result;
    }

    // Try to load from assets/scripts/<name>.wren.
    std::string path = "assets/scripts/" + std::string(name) + ".wren";
    std::ifstream file(path);
    if (!file.is_open()) return result;

    std::stringstream ss;
    ss << file.rdbuf();
    std::string src = ss.str();

    // Cache it.
    auto& info = wrapper->modules_[name];
    info.path = path;
    info.source = src;
    try {
        auto ftime = std::filesystem::last_write_time(path);
        info.last_modified = ftime.time_since_epoch().count();
    } catch (...) {}

    char* source = static_cast<char*>(std::malloc(src.size() + 1));
    std::memcpy(source, src.c_str(), src.size() + 1);
    result.source = source;
    return result;
}

}  // namespace gseurat
