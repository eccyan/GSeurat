#pragma once

#include <memory>

namespace gseurat {

// Thin shared_ptr wrapper providing ref-counted access to a loaded resource.
template <typename T>
class ResourceHandle {
public:
    ResourceHandle() = default;
    explicit ResourceHandle(std::shared_ptr<T> ptr) : ptr_(std::move(ptr)) {}

    T& operator*() { return *ptr_; }
    const T& operator*() const { return *ptr_; }
    T* operator->() { return ptr_.get(); }
    const T* operator->() const { return ptr_.get(); }
    T* get() { return ptr_.get(); }
    const T* get() const { return ptr_.get(); }

    explicit operator bool() const { return ptr_ != nullptr; }
    long use_count() const { return ptr_.use_count(); }

private:
    std::shared_ptr<T> ptr_;
};

}  // namespace gseurat
