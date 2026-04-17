#pragma once
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

namespace gseurat::platform {

class MemoryMappedFile {
public:
    MemoryMappedFile() = default;
    ~MemoryMappedFile();

    MemoryMappedFile(MemoryMappedFile&& other) noexcept;
    MemoryMappedFile& operator=(MemoryMappedFile&& other) noexcept;

    MemoryMappedFile(const MemoryMappedFile&) = delete;
    MemoryMappedFile& operator=(const MemoryMappedFile&) = delete;

    bool open(std::string_view path);
    void close();

    bool is_valid() const noexcept { return data_ != nullptr; }
    std::span<const uint8_t> data() const noexcept { return {data_, size_}; }
    size_t size() const noexcept { return size_; }

private:
    uint8_t* data_ = nullptr;
    size_t   size_ = 0;
    void* handle_a_ = nullptr;  // fd on POSIX, file HANDLE on Windows
    void* handle_b_ = nullptr;  // unused on POSIX, mapping HANDLE on Windows
};

}  // namespace gseurat::platform
