# Phase 3: `.gsaudio` Mmap Asset Pipeline — Design Spec

**Date:** 2026-04-17
**Status:** Design approved, ready for implementation planning
**Branch:** `feature/audio-phase3-mmap`
**Depends on:** Phase 1 (#273) + Phase 1.5 (#274) + Phase 2 (#275), all merged

---

## 1. Purpose and scope

Add a pre-baked binary audio format (`.gsaudio`) and memory-mapped loading via
a new `MmapAudioSource : IAudioSource` implementation. Eliminates WAV decode
overhead at load time — the file contains raw float32 PCM ready for direct use.
A Python cooker converts WAV → `.gsaudio` offline.

### In scope

- `.gsaudio` binary format: 32-byte header + raw float32 PCM payload
- Python cooker script (`tools/scripts/wav_to_gsaudio.py`)
- `MemoryMappedFile` — cross-platform RAII mmap wrapper (POSIX + Windows)
- `MmapAudioSource : IAudioSource` — mmap-backed audio source
- Format auto-detection via magic bytes (`"GSAU"`) in the engine loader
- Round-trip golden test (WAV vs `.gsaudio` produce bit-identical output)
- Island demo migration: cook field theme WAVs → `.gsaudio`, update `music_config.json`

### Out of scope

- Bundled multi-stem format (one `.gsaudio` per stem, not per track group)
- Binary metadata (JSON stays for `music_config.json`)
- Streaming from `.gsaudio` (full mmap, not chunked reads)
- SFX `.gsaudio` (SFX WAVs are tiny; mmap benefit is negligible — but auto-detection supports it)
- GSVX mmap migration (future — wrapper is reusable)

---

## 2. `.gsaudio` binary format

### Header (32 bytes, little-endian)

```
Offset  Size  Type        Field          Description
0       4     char[4]     magic          "GSAU"
4       4     uint32_le   version        1
8       4     uint32_le   sample_rate    e.g. 44100
12      1     uint8       channels       1 or 2
13      3     uint8[3]    reserved       zero
16      8     uint64_le   frame_count    total frames
24      8     uint8[8]    reserved       zero (pad to 32 bytes)
```

### Payload (offset 32)

Raw interleaved float32 PCM. Size = `frame_count * channels * 4` bytes.

Total file size = `32 + frame_count * channels * 4`.

### Validation at load

- Magic == `"GSAU"`
- Version == 1
- File size == `32 + frame_count * channels * 4`
- channels == 1 or 2
- Sample rate matches engine config (fail-loudly, same as `MemoryAudioSource`)

### Design properties

- 32-byte header guarantees payload starts at 32-byte aligned address (enables
  future SIMD/AVX/NEON vectorization)
- Little-endian throughout (matches x86, ARM, Vulkan conventions)
- Follows GSVX pattern (32-byte header + fixed-size payload, Python cooker)

---

## 3. Python cooker

`tools/scripts/wav_to_gsaudio.py`

```bash
# Single file
python3 tools/scripts/wav_to_gsaudio.py input.wav -o output.gsaudio

# Batch (convert all WAVs in a directory)
python3 tools/scripts/wav_to_gsaudio.py dir/*.wav --output-dir dir/
```

Pipeline:
1. Read WAV via Python `wave` module
2. Decode int16 samples → float32 (divide by 32767)
3. Write 32-byte header + raw float32 payload
4. Verify: re-read the `.gsaudio`, compare sample count and first/last frames

---

## 4. `MemoryMappedFile` — cross-platform RAII wrapper

```cpp
// include/gseurat/platform/memory_mapped_file.hpp
class MemoryMappedFile {
public:
    MemoryMappedFile() = default;
    ~MemoryMappedFile();
    MemoryMappedFile(MemoryMappedFile&& other) noexcept;
    MemoryMappedFile& operator=(MemoryMappedFile&& other) noexcept;
    MemoryMappedFile(const MemoryMappedFile&) = delete;

    bool open(std::string_view path);
    void close();

    bool is_valid() const noexcept;
    std::span<const uint8_t> data() const noexcept;
    size_t size() const noexcept;

private:
    uint8_t* data_ = nullptr;
    size_t   size_ = 0;
    // Platform-specific handles hidden in .cpp
#ifdef _WIN32
    void* file_handle_ = nullptr;
    void* mapping_handle_ = nullptr;
#else
    int fd_ = -1;
#endif
};
```

Implementation:
- POSIX: `open()` → `fstat()` → `mmap(PROT_READ, MAP_PRIVATE)` → store pointer
- Windows: `CreateFileW()` → `CreateFileMappingW()` → `MapViewOfFile()` → store pointer
- `close()`: unmap + close handles
- Move semantics transfer ownership; destructor calls `close()`

---

## 5. `MmapAudioSource`

```cpp
// include/gseurat/engine/audio/mmap_audio_source.hpp
class MmapAudioSource final : public IAudioSource {
public:
    static std::expected<std::unique_ptr<MmapAudioSource>, LoadError>
        from_gsaudio_file(std::string_view path, uint32_t target_sample_rate);

    AudioFormat format()       const noexcept override;
    uint64_t    total_frames() const noexcept override;
    void read_frames(uint64_t start_frame, uint32_t frame_count,
                     std::span<float> out) const noexcept override;

private:
    MemoryMappedFile   file_;        // RAII — owns the mapping
    AudioFormat        format_;
    uint64_t           frame_count_;
    const float*       pcm_start_;   // data_ + 32 bytes
};
```

`from_gsaudio_file`:
1. Opens `MemoryMappedFile`
2. Validates header (magic, version, file size, sample rate)
3. Sets `pcm_start_ = reinterpret_cast<const float*>(file_.data().data() + 32)`
4. Returns ready-to-use source

`read_frames`: `std::memcpy` from `pcm_start_ + start_frame * channels` into `out`.
Same zero-fill defense-in-depth as `MemoryAudioSource` for out-of-bounds reads.

---

## 6. Format auto-detection in engine loader

Replace direct `MemoryAudioSource::from_wav_file` calls with a format-aware helper:

```cpp
std::expected<std::unique_ptr<IAudioSource>, LoadError>
load_audio_source(std::string_view path, uint32_t sample_rate) {
    // Peek at first 4 bytes
    std::ifstream f(std::string(path), std::ios::binary);
    char magic[4]{};
    f.read(magic, 4);
    f.close();

    if (magic[0]=='G' && magic[1]=='S' && magic[2]=='A' && magic[3]=='U')
        return MmapAudioSource::from_gsaudio_file(path, sample_rate);
    return MemoryAudioSource::from_wav_file(path, sample_rate);
}
```

Used in both `load_track_group` (music stems) and `load_sfx` (SFX assets).
Transparent — callers get `IAudioSource*` regardless of format.

---

## 7. Testing

| # | Test | Assertion |
|---|---|---|
| 1 | `MemoryMappedFile` open | `is_valid()`, `size()` correct, data readable |
| 2 | `MemoryMappedFile` invalid path | `is_valid()` false |
| 3 | `MmapAudioSource` loads `.gsaudio` | format, total_frames match expected |
| 4 | `MmapAudioSource` read_frames | output matches known values |
| 5 | Magic mismatch rejected | WAV file returns `LoadError` from `from_gsaudio_file` |
| 6 | Sample rate mismatch rejected | wrong SR `.gsaudio` returns error |
| 7 | Round-trip golden | cook dc_unity.wav → .gsaudio → load → render → bit-identical to WAV path |

---

## 8. Files

**New:**
- `include/gseurat/platform/memory_mapped_file.hpp`
- `src/engine/platform/memory_mapped_file.cpp`
- `include/gseurat/engine/audio/mmap_audio_source.hpp`
- `src/engine/audio/mmap_audio_source.cpp`
- `tools/scripts/wav_to_gsaudio.py`
- `tests/test_memory_mapped_file.cpp`
- `tests/test_audio_mmap_source.cpp`
- `tests/test_data/audio/dc_unity.gsaudio` (generated by cooker)

**Modified:**
- `src/engine/audio/audio_engine.cpp` — format auto-detection
- `examples/island_demo/assets/audio/field_theme.music.json` — update stem paths
- `examples/island_demo/assets/audio/field_theme/` — add `.gsaudio` files
- `CMakeLists.txt` — new sources + tests

**Unchanged:** `IAudioSource` interface, `MemoryAudioSource`, mixer, RTPC,
effect chain, `OneshotVoice`, scene schema, Bricklayer.

---

## 9. Decision log

| # | Decision | Rationale |
|---|---|---|
| 1 | One `.gsaudio` per stem, not bundled | Simplest; individual files are debuggable; JSON metadata stays |
| 2 | RAII mmap wrapper as separate class | Reusable for GSVX; platform headers contained in `.cpp` |
| 3 | memcpy in `read_frames`, not zero-copy | Effect chain processes scratch in-place; mmap region is read-only |
| 4 | Format auto-detection via magic bytes | Robust; allows mixing WAV and `.gsaudio` freely |
| 5 | Python cooker, not C++ tool | 50 lines; integrates with build/CI; matches GSVX pattern |
| 6 | 32-byte header | Matches GSVX; payload is 32-byte aligned for future SIMD |
| 7 | Fail-loudly on sample rate mismatch | Same policy as `MemoryAudioSource`; no resampler |
