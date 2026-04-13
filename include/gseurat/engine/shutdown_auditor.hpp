#pragma once

#include <cstdio>
#include <mutex>
#include <string>
#include <typeindex>
#include <unordered_map>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dbghelp.h>
#pragma comment(lib, "dbghelp.lib")
#else
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
#ifdef _WIN32
        USHORT n = CaptureStackBackTrace(0, static_cast<DWORD>(frames.size()),
                                         frames.data(), nullptr);
        frames.resize(n);
#else
        int n = ::backtrace(frames.data(), static_cast<int>(frames.size()));
        frames.resize(static_cast<size_t>(n));
#endif
        return frames;
    }

    static void print_backtrace(const std::vector<void*>& frames) {
        if (frames.empty()) return;
#ifdef _WIN32
        HANDLE process = GetCurrentProcess();
        SymInitialize(process, nullptr, TRUE);
        alignas(SYMBOL_INFO) char buf[sizeof(SYMBOL_INFO) + 256];
        auto* sym = reinterpret_cast<SYMBOL_INFO*>(buf);
        sym->SizeOfStruct = sizeof(SYMBOL_INFO);
        sym->MaxNameLen = 255;
        // Skip first 3 frames (capture_backtrace, record, caller's caller)
        for (size_t i = 3; i < frames.size(); ++i) {
            DWORD64 addr = reinterpret_cast<DWORD64>(frames[i]);
            if (SymFromAddr(process, addr, nullptr, sym)) {
                std::fprintf(stderr, "    %s + 0x%llx\n", sym->Name,
                             static_cast<unsigned long long>(addr - sym->Address));
            } else {
                std::fprintf(stderr, "    0x%llx\n", static_cast<unsigned long long>(addr));
            }
        }
#else
        char** syms = ::backtrace_symbols(frames.data(), static_cast<int>(frames.size()));
        if (!syms) return;
        // Skip first 3 frames (capture_backtrace, record, caller's caller)
        for (size_t i = 3; i < frames.size(); ++i) {
            std::fprintf(stderr, "    %s\n", syms[i]);
        }
        ::free(syms);
#endif
    }

    static std::string demangle(const char* mangled) {
#ifdef _WIN32
        // MSVC typeid().name() already produces readable names (e.g. "class gseurat::Foo").
        // Strip the leading "class " or "struct " prefix for brevity.
        std::string name(mangled);
        if (name.substr(0, 6) == "class ") return name.substr(6);
        if (name.substr(0, 7) == "struct ") return name.substr(7);
        return name;
#else
        int status = 0;
        char* demangled = abi::__cxa_demangle(mangled, nullptr, nullptr, &status);
        if (status == 0 && demangled) {
            std::string result(demangled);
            ::free(demangled);
            return result;
        }
        return mangled;
#endif
    }
};

}  // namespace gseurat
