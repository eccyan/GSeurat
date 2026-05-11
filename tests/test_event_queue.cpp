// Phase 3a: Unit tests for gseurat::ecs::EventQueue<T> + EventRegistry +
// World::events<T>() + SystemScheduler end-of-frame rotation.
//
// Covers: same-frame read, retention across one rotate, expiry after two
// rotates, cursor non-repeat, multi-type registry isolation, World access,
// SystemScheduler-driven rotation.

#include "gseurat/engine/ecs/events.hpp"
#include "gseurat/engine/ecs/world.hpp"
#include "gseurat/engine/system_scheduler.hpp"

#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

using namespace gseurat;
using namespace gseurat::ecs;

namespace {

struct ClickEvent {
    int x = 0;
    int y = 0;
};

struct KeyEvent {
    char key = 0;
};

template <typename T>
std::vector<T> drain(EventQueue<T>& q, EventCursor& cursor) {
    std::vector<T> out;
    q.read(cursor).for_each([&](const T& e) { out.push_back(e); });
    return out;
}

}  // namespace

int main() {
    // 1. send + same-frame read returns all events in order
    {
        EventQueue<ClickEvent> q;
        q.send({1, 2});
        q.send({3, 4});
        q.send({5, 6});

        EventCursor cursor;
        auto seen = drain(q, cursor);
        assert(seen.size() == 3);
        assert(seen[0].x == 1 && seen[0].y == 2);
        assert(seen[1].x == 3 && seen[1].y == 4);
        assert(seen[2].x == 5 && seen[2].y == 6);
        std::printf("PASS: same-frame send+read in order\n");
    }

    // 2. Cursor does not repeat events on second read in same frame
    {
        EventQueue<ClickEvent> q;
        q.send({1, 1});
        q.send({2, 2});

        EventCursor cursor;
        auto first = drain(q, cursor);
        assert(first.size() == 2);

        auto second = drain(q, cursor);
        assert(second.empty());

        q.send({3, 3});
        auto third = drain(q, cursor);
        assert(third.size() == 1);
        assert(third[0].x == 3);
        std::printf("PASS: cursor advances without repeats\n");
    }

    // 3. Events sent in frame N are visible in frame N+1 (single rotate)
    {
        EventQueue<ClickEvent> q;
        q.send({7, 8});
        q.send({9, 10});

        // Cursor created mid-frame N before reading anything.
        EventCursor cursor;

        q.rotate();  // end of frame N

        // Consumer reads on frame N+1: still sees both events.
        auto seen = drain(q, cursor);
        assert(seen.size() == 2);
        assert(seen[0].x == 7);
        assert(seen[1].x == 9);
        std::printf("PASS: events retained across one rotate\n");
    }

    // 4. Events expire after two rotates (consumer skipped frame N+1)
    {
        EventQueue<ClickEvent> q;
        q.send({100, 200});

        EventCursor cursor;
        q.rotate();   // end of frame N (events now in "prev")
        q.rotate();   // end of frame N+1 (events expired, prev cleared)

        auto seen = drain(q, cursor);
        assert(seen.empty());
        std::printf("PASS: events expire after two rotates\n");
    }

    // 5. Consumer that reads on frame N then again on frame N+1 sees each event exactly once
    {
        EventQueue<ClickEvent> q;
        q.send({1, 1});
        q.send({2, 2});

        EventCursor cursor;
        auto a = drain(q, cursor);
        assert(a.size() == 2);

        q.rotate();
        q.send({3, 3});  // new event in frame N+1

        auto b = drain(q, cursor);
        // Should see only the new event — the prior two were already consumed.
        assert(b.size() == 1);
        assert(b[0].x == 3);
        std::printf("PASS: cursor survives rotate without re-reading consumed events\n");
    }

    // 6. Mixed send/rotate/send sequence: prev+curr both contain unseen events
    {
        EventQueue<ClickEvent> q;
        q.send({10, 10});  // frame N
        EventCursor cursor;
        q.rotate();        // end of N: {10,10} moves to prev
        q.send({20, 20});  // frame N+1: live in curr

        auto seen = drain(q, cursor);
        assert(seen.size() == 2);
        assert(seen[0].x == 10);  // prev first
        assert(seen[1].x == 20);  // curr second
        std::printf("PASS: read combines prev and curr in chronological order\n");
    }

    // 7. pending_count reflects total live events across both buffers
    {
        EventQueue<ClickEvent> q;
        assert(q.pending_count() == 0);
        q.send({1, 1});
        q.send({2, 2});
        assert(q.pending_count() == 2);
        q.rotate();
        q.send({3, 3});
        assert(q.pending_count() == 3);  // 2 in prev + 1 in curr
        q.rotate();
        assert(q.pending_count() == 1);  // prev cleared, 1 in (now-)prev
        std::printf("PASS: pending_count tracks both buffers\n");
    }

    // 8. EventRegistry: queues for distinct types are isolated
    {
        EventRegistry reg;
        auto& clicks = reg.get_or_create<ClickEvent>();
        auto& keys = reg.get_or_create<KeyEvent>();

        clicks.send({1, 2});
        keys.send({'a'});
        keys.send({'b'});

        assert(clicks.pending_count() == 1);
        assert(keys.pending_count() == 2);
        assert(reg.queue_count() == 2);

        // get_or_create<T> returns the same instance for the same T.
        auto& clicks_again = reg.get_or_create<ClickEvent>();
        assert(&clicks_again == &clicks);

        // try_get<T> returns the same instance, or null for unregistered T.
        assert(reg.try_get<ClickEvent>() == &clicks);
        struct Unrelated {};
        assert(reg.try_get<Unrelated>() == nullptr);
        std::printf("PASS: EventRegistry isolates per-type queues\n");
    }

    // 9. EventRegistry::rotate_all rotates every registered queue
    {
        EventRegistry reg;
        auto& clicks = reg.get_or_create<ClickEvent>();
        auto& keys = reg.get_or_create<KeyEvent>();

        clicks.send({99, 99});
        keys.send({'z'});

        reg.rotate_all();
        // Both queues' events should still be visible (one rotate behind).
        assert(clicks.pending_count() == 1);
        assert(keys.pending_count() == 1);

        reg.rotate_all();
        // Two rotates: all events expired.
        assert(clicks.pending_count() == 0);
        assert(keys.pending_count() == 0);
        std::printf("PASS: EventRegistry::rotate_all rotates every queue\n");
    }

    // 10. World::events<T>() returns the same queue across calls
    {
        World world;
        auto& q1 = world.events<ClickEvent>();
        auto& q2 = world.events<ClickEvent>();
        assert(&q1 == &q2);

        q1.send({42, 42});
        EventCursor cursor;
        auto seen = drain(q2, cursor);
        assert(seen.size() == 1);
        assert(seen[0].x == 42);
        std::printf("PASS: World::events<T> returns stable instance\n");
    }

    // 11. World::rotate_events drives event lifecycle. In Phase 4a this
    //     responsibility moved out of SystemScheduler::run_all and into
    //     AppBase::main_loop so it ticks even for game states that don't
    //     invoke the gameplay scheduler (Staging, GsDemoState).
    {
        World world;
        world.events<ClickEvent>().send({1, 1});
        world.events<ClickEvent>().send({2, 2});

        EventCursor cursor;

        // Read before first rotate: see both events.
        auto pre = drain(world.events<ClickEvent>(), cursor);
        assert(pre.size() == 2);

        world.rotate_events();  // rotate #1: events still retained

        world.events<ClickEvent>().send({3, 3});  // new event in frame N+1
        auto mid = drain(world.events<ClickEvent>(), cursor);
        assert(mid.size() == 1);
        assert(mid[0].x == 3);

        world.rotate_events();  // rotate #2: prior events expire
        world.rotate_events();  // rotate #3: {3,3} also expires

        EventCursor fresh_cursor;
        auto post = drain(world.events<ClickEvent>(), fresh_cursor);
        assert(post.empty());
        std::printf("PASS: world.rotate_events drives event lifecycle\n");
    }

    // 12. Producer system sends, consumer system reads — same frame
    {
        World world;
        SystemScheduler sched;
        std::vector<ClickEvent> consumed;
        EventCursor cursor;

        sched.add_system({"producer",
                          [](ecs::World& w, float) {
                              w.events<ClickEvent>().send({11, 22});
                          },
                          {}, {}});
        sched.add_system({"consumer",
                          [&](ecs::World& w, float) {
                              w.events<ClickEvent>().read(cursor).for_each(
                                  [&](const ClickEvent& e) { consumed.push_back(e); });
                          },
                          {}, {}});

        sched.run_all(world, 0.016f);
        assert(consumed.size() == 1);
        assert(consumed[0].x == 11 && consumed[0].y == 22);
        std::printf("PASS: producer+consumer systems in same frame\n");
    }

    // 13. World::clear() drops pending events (no leak across scene transitions)
    {
        World world;
        world.events<ClickEvent>().send({77, 88});
        world.events<KeyEvent>().send({'x'});
        assert(world.event_registry().queue_count() == 2);
        assert(world.events<ClickEvent>().pending_count() == 1);

        world.clear();

        // After clear: registry is empty; lazily recreated queue starts fresh.
        assert(world.event_registry().queue_count() == 0);
        auto& fresh = world.events<ClickEvent>();
        assert(fresh.pending_count() == 0);

        EventCursor cursor;
        auto seen = drain(fresh, cursor);
        assert(seen.empty());
        std::printf("PASS: World::clear drops pending events\n");
    }

    // 14. Cursor surviving World::clear() does NOT drop events from the
    //     freshly recreated queue (regression for Codex P2 on commit bb014684).
    //
    // Old behavior bug: queue gen reset to 0 → if cursor's last_seen_generation
    // was also 0 with nonzero per-buffer offsets, the `==` branch in read()
    // applied stale offsets and silently skipped new-scene events.
    {
        World world;

        // Pre-clear: consumer reads some events at gen 0.
        world.events<ClickEvent>().send({1, 1});
        world.events<ClickEvent>().send({2, 2});
        world.events<ClickEvent>().send({3, 3});

        EventCursor persistent_cursor;
        auto pre = drain(world.events<ClickEvent>(), persistent_cursor);
        assert(pre.size() == 3);
        // Cursor now has last_seen_generation=0, last_read_per_buffer[0]=3.

        // Scene transition.
        world.clear();
        assert(world.event_registry().epoch_floor() >= 1);

        // New-scene producer sends 2 events. Fresh queue's generation_
        // should be >= 1 (seeded from epoch_floor_), so the persistent
        // cursor's last_seen_generation=0 cannot match it.
        world.events<ClickEvent>().send({10, 10});
        world.events<ClickEvent>().send({20, 20});

        // Without the epoch fix, this would return 0 events (cursor's
        // stale offset 3 clamped to buffer size 2 → curr_start=2 → empty).
        auto post = drain(world.events<ClickEvent>(), persistent_cursor);
        assert(post.size() == 2);
        assert(post[0].x == 10);
        assert(post[1].x == 20);
        std::printf("PASS: surviving cursor reads all new events after clear\n");
    }

    // 15. Multiple clears continue to advance epoch_floor monotonically;
    //     a stale cursor across N clears still cannot collide with new queues.
    {
        EventRegistry reg;

        // Cycle 1
        reg.get_or_create<ClickEvent>().send({1, 1});
        EventCursor cursor;
        drain(reg.get_or_create<ClickEvent>(), cursor);
        reg.clear();
        const uint32_t floor1 = reg.epoch_floor();
        assert(floor1 >= 1);

        // Cycle 2 — different mix of rotates
        reg.get_or_create<ClickEvent>().send({2, 2});
        reg.get_or_create<ClickEvent>().rotate();
        reg.get_or_create<ClickEvent>().rotate();
        reg.clear();
        const uint32_t floor2 = reg.epoch_floor();
        assert(floor2 > floor1);

        // Cycle 3 — fresh queue, cursor from cycle 1 still around
        reg.get_or_create<ClickEvent>().send({3, 3});
        auto seen = drain(reg.get_or_create<ClickEvent>(), cursor);
        // Persistent cursor from cycle 1 sees the new event without skip.
        assert(seen.size() == 1);
        assert(seen[0].x == 3);
        std::printf("PASS: epoch_floor advances across multiple clears\n");
    }

    std::printf("\nALL EVENT QUEUE TESTS PASSED\n");
    return 0;
}
