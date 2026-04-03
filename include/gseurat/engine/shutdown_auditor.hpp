#pragma once

#include <cstdio>
#include <mutex>
#include <string>
#include <typeindex>
#include <unordered_map>
#include <vector>

#ifndef _WIN32
#include <cxxabi.h>
#include <execinfo.h>
#endif

namespace gseurat {

/// Tracks heap allocations of non-trivial types to diagnose shutdown hangs.
///
/// The macOS allocator hangs when freeing CharacterData (populated vectors)
/// during Vulkan/VMA teardown. This auditor logs what's alive at shutdown
/// so we can see exactly which objects the allocator chokes on.
///
/// Usage:
///   ShutdownAuditor::record<T>(ptr);       // after allocation
///   ShutdownAuditor::remove(ptr);          // before deallocation
///   ShutdownAuditor::report();             // before shutdown
///   ShutdownAuditor::try_free(ptr, name);  // guarded free with hang detection
class ShutdownAuditor {
public:
    struct ObjectInfo {
        std::type_index type = typeid(void);
        std::string type_name;
        bool is_trivial = false;
        std::vector<void*> backtrace_frames;
    };

    /// Record a heap allocation for auditing.
    template <typename T>
    static void record(void* ptr) {
        std::lock_guard lock(mtx_);
        ObjectInfo info{
            typeid(T),
            demangle(typeid(T).name()),
            std::is_trivially_destructible_v<T>,
            capture_backtrace()};
        registry_[ptr] = std::move(info);
    }

    /// Remove a tracked allocation (call before delete/reset).
    static void remove(void* ptr) {
        std::lock_guard lock(mtx_);
        registry_.erase(ptr);
    }

    /// Print all objects still alive — call before shutdown to see hang candidates.
    static void report() {
        std::lock_guard lock(mtx_);
        if (registry_.empty()) {
            std::fprintf(stderr, "[ShutdownAuditor] No tracked objects alive.\n");
            return;
        }
        std::fprintf(stderr, "[ShutdownAuditor] === Pre-Shutdown Audit ===\n");
        std::fprintf(stderr, "[ShutdownAuditor] %zu tracked object(s) alive:\n",
                     registry_.size());
        for (const auto& [ptr, info] : registry_) {
            std::fprintf(stderr, "  %p  %s  trivial_dtor=%s\n",
                         ptr, info.type_name.c_str(),
                         info.is_trivial ? "yes" : "NO");
            print_backtrace(info.backtrace_frames);
        }
        std::fprintf(stderr, "[ShutdownAuditor] === End Audit ===\n");
    }

    /// Attempt to free an object, logging before/after to detect hangs.
    /// If the process hangs inside delete, the "BEFORE" line identifies the culprit.
    template <typename T>
    static void try_free(T*& ptr, const char* label) {
        if (!ptr) return;
        std::fprintf(stderr, "[ShutdownAuditor] BEFORE free: %s (%s) at %p\n",
                     label, demangle(typeid(T).name()).c_str(),
                     static_cast<void*>(ptr));
        remove(ptr);
        delete ptr;
        ptr = nullptr;
        std::fprintf(stderr, "[ShutdownAuditor] AFTER  free: %s — OK\n", label);
    }

private:
    inline static std::unordered_map<void*, ObjectInfo> registry_;
    inline static std::mutex mtx_;

    static std::vector<void*> capture_backtrace() {
        std::vector<void*> frames(16);
#ifndef _WIN32
        int n = ::backtrace(frames.data(), static_cast<int>(frames.size()));
        frames.resize(static_cast<size_t>(n));
#else
        frames.clear();
#endif
        return frames;
    }

    static void print_backtrace(const std::vector<void*>& frames) {
#ifndef _WIN32
        if (frames.empty()) return;
        char** syms = ::backtrace_symbols(frames.data(), static_cast<int>(frames.size()));
        if (!syms) return;
        // Skip first 3 frames (capture_backtrace, record, caller's caller)
        for (size_t i = 3; i < frames.size(); ++i) {
            std::fprintf(stderr, "    %s\n", syms[i]);
        }
        ::free(syms);
#else
        (void)frames;
#endif
    }

    static std::string demangle(const char* mangled) {
#ifndef _WIN32
        int status = 0;
        char* demangled = abi::__cxa_demangle(mangled, nullptr, nullptr, &status);
        if (status == 0 && demangled) {
            std::string result(demangled);
            ::free(demangled);
            return result;
        }
#endif
        return mangled;
    }
};

}  // namespace gseurat
