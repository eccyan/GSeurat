#pragma once

// Phase 3a: Typed event bus (Bevy `Events<T>` model).
//
// Per-event-type queues with 2-frame retention. Producers call `send(T)`;
// consumers poll via `read(EventCursor&)`. `EventCleanupStage` (driven by
// SystemScheduler::run_all) rotates buffers at end-of-frame so events sent
// in frame N stay visible through frame N+1, then expire.
//
// Scope of this PR: infrastructure only. No callers migrate yet (Phase 4).

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <typeindex>
#include <unordered_map>
#include <utility>
#include <vector>

namespace gseurat::ecs {

inline constexpr uint32_t kEventRetentionFrames = 2;

// Per-consumer cursor. Tracks the last event seen across rotates.
//
// `last_seen_generation` advances each time the queue rotates; the cursor
// uses it to know whether `last_read_per_buffer` is still valid for the
// queue's current buffer pairing.
struct EventCursor {
    uint32_t last_seen_generation = 0;
    std::size_t last_read_per_buffer[kEventRetentionFrames] = {0, 0};
};

// Span-pair view returned by EventQueue<T>::read. Iterating yields events
// in chronological order: previous frame first, then current frame.
template <typename T>
class EventReader {
public:
    EventReader() = default;
    EventReader(std::span<const T> prev, std::span<const T> curr) noexcept
        : prev_(prev), curr_(curr) {}

    std::span<const T> prev_frame() const noexcept { return prev_; }
    std::span<const T> curr_frame() const noexcept { return curr_; }

    std::size_t size() const noexcept { return prev_.size() + curr_.size(); }
    bool empty() const noexcept { return prev_.empty() && curr_.empty(); }

    // Iterate prev then curr via callback. Returns count visited.
    template <typename F>
    std::size_t for_each(F&& fn) const {
        std::size_t n = 0;
        for (const auto& e : prev_) { fn(e); ++n; }
        for (const auto& e : curr_) { fn(e); ++n; }
        return n;
    }

private:
    std::span<const T> prev_;
    std::span<const T> curr_;
};

// Type-erased base so the registry can hold heterogeneous queues.
class EventQueueBase {
public:
    virtual ~EventQueueBase();
    virtual void rotate() noexcept = 0;
    virtual std::size_t pending_count() const noexcept = 0;
    // Exposed so EventRegistry::clear() can advance its epoch floor past
    // any live queue's current generation, preventing cursor collisions
    // with freshly recreated queues.
    virtual uint32_t current_generation() const noexcept = 0;
};

template <typename T>
class EventQueue final : public EventQueueBase {
public:
    EventQueue() = default;
    // Seed `generation_` past any prior generation a stale cursor might
    // be carrying. Used by EventRegistry to make post-clear queues immune
    // to cursors that survived World::clear() — see EventRegistry::clear.
    explicit EventQueue(uint32_t initial_generation) noexcept
        : generation_(initial_generation) {}

    void send(T evt) {
        buffers_[write_idx_].push_back(std::move(evt));
    }

    template <typename... Args>
    void emplace(Args&&... args) {
        buffers_[write_idx_].emplace_back(std::forward<Args>(args)...);
    }

    // Returns unread events as a (prev_frame, curr_frame) span pair and
    // advances the cursor in place. Safe across rotates.
    EventReader<T> read(EventCursor& cursor) const noexcept {
        const uint8_t prev_idx = static_cast<uint8_t>(1u - write_idx_);
        const std::vector<T>& prev_buf = buffers_[prev_idx];
        const std::vector<T>& curr_buf = buffers_[write_idx_];

        // If cursor is from an older generation, prior per-buffer offsets
        // are stale. The previous buffer is what was "current" at cursor
        // capture time (now demoted to prev), so its offset still applies;
        // the current buffer is new and should be read from the start.
        std::size_t prev_start = 0;
        std::size_t curr_start = 0;
        if (cursor.last_seen_generation == generation_) {
            prev_start = std::min(cursor.last_read_per_buffer[prev_idx], prev_buf.size());
            curr_start = std::min(cursor.last_read_per_buffer[write_idx_], curr_buf.size());
        } else if (cursor.last_seen_generation + 1 == generation_) {
            // Single rotate behind: what was the cursor's "curr" is now "prev"
            // (its events are still retained); the new curr buffer is fresh.
            prev_start = std::min(cursor.last_read_per_buffer[prev_idx], prev_buf.size());
            curr_start = 0;
        } else {
            // Two or more rotates behind: all previously seen events have
            // expired. Read everything currently retained.
            prev_start = 0;
            curr_start = 0;
        }

        // Guard against `data() + offset` UB on empty vectors: libc++'s
        // empty std::vector returns nullptr from data(), and `nullptr + 0`
        // is undefined per the C++ standard (UBSan flags it). Construct an
        // empty span explicitly when there's nothing to read from a buffer.
        std::span<const T> prev_span = (prev_start < prev_buf.size())
            ? std::span<const T>{prev_buf.data() + prev_start, prev_buf.size() - prev_start}
            : std::span<const T>{};
        std::span<const T> curr_span = (curr_start < curr_buf.size())
            ? std::span<const T>{curr_buf.data() + curr_start, curr_buf.size() - curr_start}
            : std::span<const T>{};

        cursor.last_seen_generation = generation_;
        cursor.last_read_per_buffer[prev_idx] = prev_buf.size();
        cursor.last_read_per_buffer[write_idx_] = curr_buf.size();

        return EventReader<T>(prev_span, curr_span);
    }

    void rotate() noexcept override {
        write_idx_ = static_cast<uint8_t>(1u - write_idx_);
        buffers_[write_idx_].clear();
        ++generation_;
    }

    // Drop every pending event in both buffers. Used when a scene-level
    // teardown happens between an event send and the next drain (e.g.
    // StagingApp::clear_scene during a bridge poll cycle that mixed
    // update_scene_data and open_scene). Bumps generation so any
    // surviving cursor falls into the "expired" branch on next read
    // and cannot apply stale per-buffer offsets to the empty buffers.
    void clear() noexcept {
        buffers_[0].clear();
        buffers_[1].clear();
        ++generation_;
    }

    std::size_t pending_count() const noexcept override {
        return buffers_[0].size() + buffers_[1].size();
    }

    uint32_t current_generation() const noexcept override { return generation_; }
    uint32_t generation() const noexcept { return generation_; }

private:
    std::array<std::vector<T>, kEventRetentionFrames> buffers_{};
    uint8_t write_idx_ = 0;
    uint32_t generation_ = 0;
};

// Type-erased registry of EventQueue<T> instances, keyed by std::type_index.
// One queue per distinct T; lazily created on first `get_or_create<T>()`.
class EventRegistry {
public:
    template <typename T>
    EventQueue<T>& get_or_create() {
        const std::type_index key = std::type_index(typeid(T));
        auto it = queues_.find(key);
        if (it != queues_.end()) {
            return *static_cast<EventQueue<T>*>(it->second.get());
        }
        // Seed the new queue's generation past the epoch floor so any
        // cursor surviving a prior clear() cannot collide with this
        // queue's starting generation.
        auto owned = std::make_unique<EventQueue<T>>(epoch_floor_);
        EventQueue<T>* raw = owned.get();
        queues_.emplace(key, std::move(owned));
        return *raw;
    }

    template <typename T>
    EventQueue<T>* try_get() {
        const std::type_index key = std::type_index(typeid(T));
        auto it = queues_.find(key);
        if (it == queues_.end()) return nullptr;
        return static_cast<EventQueue<T>*>(it->second.get());
    }

    void rotate_all() noexcept;

    // Drop every registered queue. Used when the host clears the World (e.g.
    // scene transition) so stale events from the prior scene cannot leak
    // into consumers on the new scene.
    //
    // Also advances `epoch_floor_` past the highest live queue generation
    // so a long-lived EventCursor that survived the clear cannot match the
    // generation of any freshly recreated queue (which would otherwise
    // cause its stale per-buffer offsets to silently skip new events).
    void clear() noexcept {
        for (auto& [type_idx, queue] : queues_) {
            if (queue->current_generation() >= epoch_floor_) {
                epoch_floor_ = queue->current_generation() + 1;
            }
        }
        queues_.clear();
    }

    std::size_t queue_count() const noexcept { return queues_.size(); }
    uint32_t epoch_floor() const noexcept { return epoch_floor_; }

private:
    std::unordered_map<std::type_index, std::unique_ptr<EventQueueBase>> queues_;
    uint32_t epoch_floor_ = 0;
};

}  // namespace gseurat::ecs
