# Camera Review Mode — Integration Test Plan

**Goal:** End-to-end verification of the Bricklayer → Staging camera review workflow, following the same steps a level designer would take.

**Scope:** Camera zone authoring in Bricklayer, data transfer to Staging, Camera Review Mode activation, WASD movement, zone transitions, gizmo rendering, and Game Director automation.

---

## Test Scenarios

### Scenario 1: Author Camera Zones in Bricklayer
**Steps:**
1. Open Bricklayer at http://localhost:5180/
2. Create a scene with terrain PLY
3. Add 3 camera volumes:
   - `open_field` (free_look, AABB, large area)
   - `narrow_path` (rail_follow, AABB, narrow corridor)
   - `lookout` (fixed_point, sphere, elevated viewpoint)
4. Add 1 camera rail (`path_cam`) with 5+ control points
5. Add 1 trigger zone between `open_field` and `narrow_path`
6. Verify gizmos render in viewport (cyan wireframes, yellow rail spline)

**Expected:** All 3 volumes, 1 rail, 1 trigger visible in Bricklayer viewport with correct gizmo colors.

### Scenario 2: Send to Staging and Verify Data Transfer
**Steps:**
1. Use File → "Open in Staging" in Bricklayer
2. Via Game Director: `camera_review status` — should show "not active"
3. Via Game Director: `camera_review on` — should report 3 zones, 1 trigger, 1 rail
4. Verify volume/trigger/rail counts match Bricklayer scene

**Expected:** All camera zone data transfers correctly. Counts match.

### Scenario 3: Camera Review Mode Activation and WASD Movement
**Steps:**
1. Activate via Game Director: `camera_review on`
2. Check status: zone should be `world_fallback` or `open_field` depending on spawn position
3. Teleport to open_field center: `camera_review_teleport <x> <z>`
4. Verify zone changes to `open_field`
5. Walk forward 2s: `camera_review_walk forward 2`
6. Verify position changed
7. Walk back 2s: verify returns near original position
8. Test all 4 directions: forward, back, left, right
9. Test speed: verify distance covered scales with speed setting

**Expected:** Player moves in correct directions. Position updates persist across frames. Zone resolves correctly based on position.

### Scenario 4: Zone Transitions and Camera Behavior
**Steps:**
1. Teleport to `open_field` center → verify mode: `free_look`
2. Teleport to `narrow_path` center → verify mode: `rail_follow`
3. Teleport to `lookout` center → verify mode: `fixed_point`
4. Walk from open_field toward narrow_path → verify transition occurs
5. Check `is_transitioning` during blend
6. Verify MoveReference auto-switches: free_look → camera_facing, rail_follow → world_axis

**Expected:** Camera mode changes on zone entry. Blending transitions work. MoveReference auto-switches correctly.

### Scenario 5: Gizmo Rendering
**Steps:**
1. Take screenshot in orbit mode (review off) with gizmos enabled → verify zone wireframes visible
2. Activate review mode → take screenshot → verify player marker (green dot) visible
3. Teleport to different zones → verify active zone wireframe highlights (brighter cyan)
4. Verify trigger wireframe (magenta) and rail spline (yellow) visible

**Expected:** All gizmo types render correctly in both orbit and review modes.

### Scenario 6: Game Director Automated Walkthrough
**Steps:**
1. Activate review: `camera_review on`
2. Teleport to each volume center, take screenshot, verify zone name
3. Walk between zones, verify transitions
4. Deactivate: `camera_review off`
5. Reactivate: `camera_review on` — verify clean restart
6. Full sequence with screenshots at each step

**Expected:** Automated walkthrough completes without errors. All zone names resolve correctly.

### Scenario 7: Edge Cases
**Steps:**
1. Scene with no camera_zones → `camera_review on` should fail gracefully
2. Scene reload while in review mode → review should re-activate with new data
3. Deactivate/reactivate cycle → state should reset cleanly
4. Teleport to coordinates far outside all volumes → should show `world_fallback`
5. Send empty scene → verify no crash

**Expected:** All edge cases handled gracefully without crashes or stale state.

---

## Issue Tracking

Issues found during testing will be logged as GitHub Issues with:
- Clear reproduction steps
- Screenshots where applicable
- Severity label (bug, enhancement, UX)
