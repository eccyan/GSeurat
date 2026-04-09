# Camera Review Teleport Facing Fix

## Problem

When teleporting to a camera volume in Staging's camera review mode (via "Go to Volume" button, right-click, or socket command), the orbit camera snaps to the default azimuth of 0 radians. This places the camera at +Z relative to the player, facing backward (-Z). The expected behavior is to preserve the camera's current viewing direction across the teleport.

The root cause is that `CameraZoneSystem::orbit_azimuth_` and `orbit_elevation_` are never updated on teleport — they retain whatever value they had previously (default 0.0 and 0.3 respectively).

## Solution

Add `set_orbit_from_camera(cam_pos, cam_target)` to `CameraZoneSystem`. This method computes azimuth and elevation from the current camera direction using the inverse of the spherical-to-cartesian formula already used in `evaluate_vcam()`.

Call this method from `CameraReviewState::teleport()` before moving the player, so the orbit angles match the outgoing camera's viewing direction.

## Changes

### 1. CameraZoneSystem — New public method

**File:** `include/gseurat/engine/camera_zone_system.hpp`

Add:
```cpp
void set_orbit_from_camera(glm::vec3 cam_pos, glm::vec3 cam_target);
```

### 2. CameraZoneSystem — Implementation

**File:** `src/engine/camera_zone_system.cpp`

The inverse of the spherical offset in `evaluate_vcam()`:

```
orbit_offset = cam_pos - cam_target
dir = normalize(orbit_offset)
azimuth   = atan2(dir.x, dir.z)
elevation = asin(dir.y)
```

This is the exact inverse of:
```
x = distance * cos(elevation) * sin(azimuth)
y = distance * sin(elevation)
z = distance * cos(elevation) * cos(azimuth)
```

### 3. CameraReviewState::teleport() — Call before repositioning

**File:** `src/staging/camera_review_state.cpp`

In both `teleport(x, z)` and `teleport(x, y, z)` overloads, before updating `player_pos_`:

```cpp
CameraState cam = zone_system_.current_state();
zone_system_.set_orbit_from_camera(cam.position, cam.target);
```

This preserves the current camera direction. After the player moves and `update()` runs, the orbit camera starts from the preserved direction rather than the default.

### 4. Test

**File:** `tests/test_camera_zone_system.cpp`

Verify that `set_orbit_from_camera()` correctly converts camera position/target to azimuth/elevation by:
1. Setting a known camera direction via `set_orbit_from_camera`
2. Running one `update()` frame
3. Checking that `current_state()` produces a camera facing approximately the same direction

## Scope

- All teleport sources (UI button, right-click, socket command) go through `CameraReviewState::teleport()`, so all are fixed.
- Natural walking transitions (zone changes without teleport) are not affected — the orbit angles continue to update via mouse input as before.
- No scene format or Bricklayer changes.

## What Is NOT In Scope

- Persisting a "default facing" per volume in the scene JSON
- Changing behavior of walking zone transitions
