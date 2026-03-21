#pragma once

#include <wren.hpp>

#include <functional>
#include <string>
#include <unordered_map>

namespace vulkan_game {

class AppBase;

// Callback for binding foreign methods to Wren classes.
using ForeignMethodFn = WrenForeignMethodFn;
using BindForeignMethodCallback = std::function<ForeignMethodFn(
    const char* module, const char* className,
    bool isStatic, const char* signature)>;

class WrenVM {
public:
    WrenVM() = default;
    ~WrenVM();

    WrenVM(const WrenVM&) = delete;
    WrenVM& operator=(const WrenVM&) = delete;

    void init(AppBase* app);
    void shutdown();

    // Load and interpret a module from a file path.
    bool load_module(const std::string& module_name, const std::string& path);

    // Interpret a string of Wren source code in a module.
    bool interpret(const std::string& module_name, const std::string& source);

    // Call a static method on a class. Returns true on success.
    // Signature example: "update(_,_)" for a method taking 2 args.
    bool call_method(const std::string& module_name,
                     const std::string& class_name,
                     const std::string& signature);

    // Register a foreign method binding callback.
    void set_bind_foreign_method(BindForeignMethodCallback cb) {
        bind_foreign_method_cb_ = std::move(cb);
    }

    // Get the underlying Wren VM pointer (for bindings).
    ::WrenVM* vm() { return vm_; }
    AppBase* app() { return app_; }

    // Hot-reload: check file timestamps and reload changed modules.
    void check_hot_reload();

    // Track module file paths for hot-reload.
    void register_module_path(const std::string& module_name, const std::string& path);

private:
    static void write_fn(::WrenVM* vm, const char* text);
    static void error_fn(::WrenVM* vm, WrenErrorType type,
                         const char* module, int line, const char* message);
    static WrenForeignMethodFn bind_foreign_method_fn(
        ::WrenVM* vm, const char* module, const char* className,
        bool isStatic, const char* signature);
    static WrenLoadModuleResult load_module_fn(::WrenVM* vm, const char* name);

    ::WrenVM* vm_ = nullptr;
    AppBase* app_ = nullptr;
    BindForeignMethodCallback bind_foreign_method_cb_;

    // Module source cache for hot-reload.
    struct ModuleInfo {
        std::string path;
        std::string source;
        long long last_modified = 0;
    };
    std::unordered_map<std::string, ModuleInfo> modules_;

    // Method call handles cache.
    std::unordered_map<std::string, WrenHandle*> call_handles_;
    std::unordered_map<std::string, WrenHandle*> class_handles_;

    WrenHandle* get_or_create_call_handle(const std::string& signature);
    WrenHandle* get_or_create_class_handle(const std::string& module_name,
                                            const std::string& class_name);
};

}  // namespace vulkan_game
