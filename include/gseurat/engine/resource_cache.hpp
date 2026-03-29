#pragma once

#include "gseurat/engine/resource_handle.hpp"

#include <functional>
#include <memory>
#include <string>
#include <unordered_map>

namespace gseurat {

// Generic string-keyed cache that returns shared_ptr-backed handles.
// Uses weak_ptr storage so resources are freed when all handles are released.
template <typename T>
class ResourceCache {
public:
    using LoaderFn = std::function<std::shared_ptr<T>(const std::string& key)>;

    void set_loader(LoaderFn fn) { loader_ = std::move(fn); }

    ResourceHandle<T> get(const std::string& key) {
        auto it = cache_.find(key);
        if (it != cache_.end()) {
            if (auto sp = it->second.lock()) {
                return ResourceHandle<T>(sp);
            }
            cache_.erase(it);
        }
        if (!loader_) return {};
        auto ptr = loader_(key);
        if (!ptr) return {};
        cache_[key] = ptr;
        return ResourceHandle<T>(std::move(ptr));
    }

    ResourceHandle<T> insert(const std::string& key, std::shared_ptr<T> ptr) {
        cache_[key] = ptr;
        return ResourceHandle<T>(std::move(ptr));
    }

    bool contains(const std::string& key) const {
        auto it = cache_.find(key);
        return it != cache_.end() && !it->second.expired();
    }

    void clear() { cache_.clear(); }

    // Call fn for each live (non-expired) resource
    template <typename Fn>
    void for_each_live(Fn fn) {
        for (auto& [key, wp] : cache_) {
            if (auto sp = wp.lock()) {
                fn(key, *sp);
            }
        }
    }

private:
    LoaderFn loader_;
    std::unordered_map<std::string, std::weak_ptr<T>> cache_;
};

}  // namespace gseurat
