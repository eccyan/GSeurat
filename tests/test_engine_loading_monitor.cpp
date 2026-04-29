// Pure-CPU unit test for EngineLoadingMonitor — covers state transitions,
// warm-up countdown, frame-policy helpers, and edge cases (empty handle
// list, missing status provider, scene-restart from Playing).

#include "gseurat/engine/engine_state.hpp"

#include <cstdio>
#include <cstdlib>
#include <unordered_map>

using namespace gseurat;

namespace {

void expect(bool cond, const char* msg) {
    if (!cond) {
        std::fprintf(stderr, "FAIL: %s\n", msg);
        std::exit(1);
    }
}

// Programmable status table used as the StatusProvider in tests.
struct MockStatuses {
    std::unordered_map<std::uint64_t, TransferQueue::Status> by_id;

    EngineLoadingMonitor::StatusProvider provider() const {
        return [this](TransferQueue::Handle h) {
            auto it = by_id.find(h.id);
            return (it == by_id.end()) ? TransferQueue::Status::Pending : it->second;
        };
    }
};

}  // namespace

int main() {
    // ── 1. Default state is Playing (backward-compat: apps that never call
    //      begin_load see today's behaviour). ──────────────────────────────
    {
        EngineLoadingMonitor m;
        expect(m.state() == EngineState::Playing, "default state is Playing");
        expect(m.should_run_gameplay(),            "Playing → run gameplay");
        expect(m.should_dispatch_gpu_work(),       "Playing → dispatch GPU work");
        expect(!m.should_overlay_loading_ui(),     "Playing → no loading overlay");
        expect(m.pending_handles() == 0,           "no pending handles");
        expect(m.warmup_frames() == EngineLoadingMonitor::kDefaultWarmupFrames,
               "default warm-up frames matches constant");
        std::printf("[TEST] default state Playing\n");
    }

    // ── 2. begin_load → Loading; gating helpers correct. ─────────────────
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{1}, TransferQueue::Handle{2}});

        expect(m.state() == EngineState::Loading,   "begin_load → Loading");
        expect(!m.should_run_gameplay(),            "Loading → no gameplay");
        expect(!m.should_dispatch_gpu_work(),       "Loading → no GPU dispatch");
        expect(m.should_overlay_loading_ui(),       "Loading → overlay UI");
        expect(m.pending_handles() == 2,            "two handles tracked");
        std::printf("[TEST] begin_load → Loading + correct gating\n");
    }

    // ── 3. Pending handles keep state in Loading. ────────────────────────
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{1}, TransferQueue::Handle{2}});

        MockStatuses ms;
        ms.by_id[1] = TransferQueue::Status::Pending;
        ms.by_id[2] = TransferQueue::Status::InFlight;

        for (int i = 0; i < 5; ++i) m.tick(ms.provider());
        expect(m.state() == EngineState::Loading,   "Pending handles → still Loading");
        expect(m.pending_handles() == 2,            "no handles reaped");
        std::printf("[TEST] Pending handles keep Loading\n");
    }

    // ── 4. Partial completion still Loading; full completion → Warming. ──
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{1}, TransferQueue::Handle{2}});

        MockStatuses ms;
        ms.by_id[1] = TransferQueue::Status::Complete;
        ms.by_id[2] = TransferQueue::Status::Pending;

        m.tick(ms.provider());
        expect(m.state() == EngineState::Loading,   "h1 done, h2 pending → still Loading");
        expect(m.pending_handles() == 1,            "h1 reaped");

        ms.by_id[2] = TransferQueue::Status::Complete;
        m.tick(ms.provider());
        expect(m.state() == EngineState::Warming,   "all complete → Warming");
        expect(m.warmup_frames_remaining() == EngineLoadingMonitor::kDefaultWarmupFrames,
               "warm-up countdown initialised");
        expect(!m.should_run_gameplay(),            "Warming → no gameplay yet");
        expect(m.should_dispatch_gpu_work(),        "Warming → dispatch GPU work");
        expect(m.should_overlay_loading_ui(),       "Warming → still overlay UI");
        std::printf("[TEST] partial → full completion → Warming\n");
    }

    // ── 5. Warming counts down N frames then Playing. ────────────────────
    {
        EngineLoadingMonitor m;
        m.set_warmup_frames(3);
        m.begin_load({TransferQueue::Handle{1}});

        MockStatuses ms;
        ms.by_id[1] = TransferQueue::Status::Complete;

        m.tick(ms.provider());
        expect(m.state() == EngineState::Warming,   "Warming after first tick");
        expect(m.warmup_frames_remaining() == 3,    "3 warm-up frames remaining");

        m.tick(ms.provider());
        expect(m.warmup_frames_remaining() == 2,    "2 remaining");
        m.tick(ms.provider());
        expect(m.warmup_frames_remaining() == 1,    "1 remaining");
        expect(m.state() == EngineState::Warming,   "still Warming with 1 left");

        m.tick(ms.provider());
        expect(m.warmup_frames_remaining() == 0,    "0 remaining");
        expect(m.state() == EngineState::Playing,   "→ Playing after countdown");
        expect(m.should_run_gameplay(),             "Playing → gameplay back on");
        std::printf("[TEST] Warming counts down 3 frames → Playing\n");
    }

    // ── 6. Re-entering Loading from Playing (scene transition). ─────────
    {
        EngineLoadingMonitor m;
        m.begin_load({});                             // empty list → fast path
        m.tick(MockStatuses{}.provider());            // → Warming
        for (std::uint32_t i = 0; i < EngineLoadingMonitor::kDefaultWarmupFrames; ++i) {
            m.tick(MockStatuses{}.provider());
        }
        expect(m.state() == EngineState::Playing,   "fast path reaches Playing");

        m.begin_load({TransferQueue::Handle{42}});
        expect(m.state() == EngineState::Loading,   "Playing → begin_load → Loading");
        expect(m.pending_handles() == 1,            "tracking new handle");
        std::printf("[TEST] re-enter Loading from Playing\n");
    }

    // ── 7. Empty handle list — skip-load fast path. ─────────────────────
    {
        EngineLoadingMonitor m;
        m.begin_load({});
        expect(m.state() == EngineState::Loading,   "even empty load starts in Loading");
        m.tick(MockStatuses{}.provider());
        expect(m.state() == EngineState::Warming,   "empty list → Warming on first tick");
        std::printf("[TEST] empty handle list → fast Warming\n");
    }

    // ── 8. Failed status counts as resolved (don't deadlock). ───────────
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{7}, TransferQueue::Handle{8}});
        MockStatuses ms;
        ms.by_id[7] = TransferQueue::Status::Failed;
        ms.by_id[8] = TransferQueue::Status::Complete;
        m.tick(ms.provider());
        expect(m.state() == EngineState::Warming,   "Failed treated as resolved");
        std::printf("[TEST] Failed status doesn't stall the monitor\n");
    }

    // ── 9. Empty/null provider during Loading is a safe no-op. ──────────
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{9}});
        EngineLoadingMonitor::StatusProvider null_provider;
        m.tick(null_provider);                        // must not crash
        expect(m.state() == EngineState::Loading,   "null provider → no progress");
        expect(m.pending_handles() == 1,            "handle still tracked");
        std::printf("[TEST] null provider during Loading is safe\n");
    }

    // ── 10. set_warmup_frames clamps to [1, kMaxWarmupFrames]. ──────────
    {
        EngineLoadingMonitor m;
        m.set_warmup_frames(0);
        expect(m.warmup_frames() == 1, "0 clamped up to 1");
        m.set_warmup_frames(EngineLoadingMonitor::kMaxWarmupFrames + 100);
        expect(m.warmup_frames() == EngineLoadingMonitor::kMaxWarmupFrames,
               "huge value clamped to max");
        std::printf("[TEST] set_warmup_frames clamps correctly\n");
    }

    // ── 11. Unknown status counts as resolved (handle aged out / never
    //        tracked). Without this, the queue's ~64-entry recent_status_
    //        cap would let large batches strand older completed handles
    //        in tracked_, deadlocking the monitor in Loading. ───────────
    {
        EngineLoadingMonitor m;
        m.begin_load({TransferQueue::Handle{100}, TransferQueue::Handle{101}});
        // Provider returns Unknown for both handles — simulating either
        // aged-out cache entries or handles never seen by the queue.
        EngineLoadingMonitor::StatusProvider unknown_provider =
            [](TransferQueue::Handle) {
                return TransferQueue::Status::Unknown;
            };
        m.tick(unknown_provider);
        expect(m.state() == EngineState::Warming,
               "Unknown handles count as resolved → Warming");
        std::printf("[TEST] Unknown status counts as resolved\n");
    }

    // ── 12. Tick during Playing is a no-op (steady state). ──────────────
    {
        EngineLoadingMonitor m;                       // starts Playing
        for (int i = 0; i < 100; ++i) m.tick(MockStatuses{}.provider());
        expect(m.state() == EngineState::Playing,   "still Playing after many ticks");
        expect(m.warmup_frames_remaining() == 0,    "no warm-up running");
        std::printf("[TEST] Playing tick is a no-op\n");
    }

    std::printf("[ALL TESTS PASSED]\n");
    return 0;
}
