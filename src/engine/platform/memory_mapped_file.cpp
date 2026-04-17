#include "gseurat/platform/memory_mapped_file.hpp"
#include <string>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace gseurat::platform {

MemoryMappedFile::~MemoryMappedFile() { close(); }

MemoryMappedFile::MemoryMappedFile(MemoryMappedFile&& other) noexcept
    : data_(other.data_), size_(other.size_),
      handle_a_(other.handle_a_), handle_b_(other.handle_b_) {
    other.data_ = nullptr; other.size_ = 0;
    other.handle_a_ = nullptr; other.handle_b_ = nullptr;
}

MemoryMappedFile& MemoryMappedFile::operator=(MemoryMappedFile&& other) noexcept {
    if (this != &other) {
        close();
        data_ = other.data_; size_ = other.size_;
        handle_a_ = other.handle_a_; handle_b_ = other.handle_b_;
        other.data_ = nullptr; other.size_ = 0;
        other.handle_a_ = nullptr; other.handle_b_ = nullptr;
    }
    return *this;
}

#ifdef _WIN32
bool MemoryMappedFile::open(std::string_view path) {
    close();
    std::string p(path);
    HANDLE file = CreateFileA(p.c_str(), GENERIC_READ, FILE_SHARE_READ,
                               nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz;
    if (!GetFileSizeEx(file, &sz)) { CloseHandle(file); return false; }
    if (sz.QuadPart == 0) { CloseHandle(file); return false; }
    HANDLE mapping = CreateFileMappingA(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
    if (!mapping) { CloseHandle(file); return false; }
    void* view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
    if (!view) { CloseHandle(mapping); CloseHandle(file); return false; }
    data_ = static_cast<uint8_t*>(view);
    size_ = static_cast<size_t>(sz.QuadPart);
    handle_a_ = file; handle_b_ = mapping;
    return true;
}
void MemoryMappedFile::close() {
    if (data_) { UnmapViewOfFile(data_); data_ = nullptr; }
    if (handle_b_) { CloseHandle(handle_b_); handle_b_ = nullptr; }
    if (handle_a_) { CloseHandle(handle_a_); handle_a_ = nullptr; }
    size_ = 0;
}
#else
bool MemoryMappedFile::open(std::string_view path) {
    close();
    std::string p(path);
    int fd = ::open(p.c_str(), O_RDONLY);
    if (fd < 0) return false;
    struct stat st{};
    if (fstat(fd, &st) < 0) { ::close(fd); return false; }
    size_t fsz = static_cast<size_t>(st.st_size);
    if (fsz == 0) { ::close(fd); return false; }
    void* mapped = mmap(nullptr, fsz, PROT_READ, MAP_PRIVATE, fd, 0);
    if (mapped == MAP_FAILED) { ::close(fd); return false; }
    data_ = static_cast<uint8_t*>(mapped);
    size_ = fsz;
    handle_a_ = reinterpret_cast<void*>(static_cast<intptr_t>(fd));
    return true;
}
void MemoryMappedFile::close() {
    if (data_) { munmap(data_, size_); data_ = nullptr; }
    if (handle_a_) {
        ::close(static_cast<int>(reinterpret_cast<intptr_t>(handle_a_)));
        handle_a_ = nullptr;
    }
    size_ = 0;
}
#endif

}  // namespace gseurat::platform
