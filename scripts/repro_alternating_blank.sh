#!/usr/bin/env bash
# Reproduce the alternating-blank-frame pattern using two parallel capture
# methods so we can cross-reference what's actually on screen vs. what the
# Game Director thinks it sees.
#
# Method A: macOS `screencapture -x` against the demo window in a tight loop.
#   Catches every swapchain present at ~10 Hz — the same vantage as a user
#   watching the window or doing QuickTime screen recording.
#
# Method B: Game Director `screenshot` command via the demo's control socket.
#   Internally copies swapchain_.image(image_index) into a staging buffer
#   AFTER the composite render pass + UI overlay, waits on the in-flight
#   fence, swizzles BGRA→RGBA, and writes PNG. This is the same image the
#   user sees presented, but timed to whatever frame happened to be in
#   flight when the request landed.
#
# Both write into /tmp/repro_blank/ . Sizes < ~50KB are likely blank/uniform
# frames; gameplay frames sit at ~250-290KB at the demo's 320×240 internal
# resolution (upscaled).
#
# Usage:
#   bash scripts/repro_alternating_blank.sh         # 60 captures of each method
#   bash scripts/repro_alternating_blank.sh 120     # 120 captures of each method

set -euo pipefail

NSAMPLES="${1:-60}"
OUT=/tmp/repro_blank
WORKTREE="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="$WORKTREE/build/macos-debug/gseurat_demo"
GAMEDIR_PY="$WORKTREE/scripts/game_director.py"

if [[ ! -x "$DEMO" ]]; then
  echo "demo binary not found: $DEMO"
  echo "build first: cmake --build --preset macos-debug --target gseurat_demo"
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/screencapture" "$OUT/gamedir"

# Kill any previous instance so the run is deterministic.
pkill -9 -f gseurat_demo 2>/dev/null || true
sleep 1

# Launch the demo. CWD must be its build dir so the "assets/..." paths
# resolve. nohup + & so this script keeps control.
(
  cd "$(dirname "$DEMO")"
  nohup "$DEMO" > "$OUT/demo.log" 2>&1 &
)
DEMO_PID=$(pgrep -f gseurat_demo | head -1)
echo "demo pid=$DEMO_PID, log=$OUT/demo.log"

# Wait for the demo to actually reach Playing (dispatch=1). Bound to 30s.
echo "waiting for Playing state..."
for _ in $(seq 1 60); do
  if grep -q "dispatch=1" "$OUT/demo.log" 2>/dev/null; then
    echo "  reached Playing"
    break
  fi
  sleep 0.5
done

# Now race two captures in parallel. macOS screencapture targets the
# frontmost window of the demo process by id; -x suppresses the shutter
# sound. The Game Director loop runs every ~100ms to interleave with
# the demo's frame cadence.
echo "capturing $NSAMPLES samples per method (~10 Hz each)..."

(
  for i in $(seq -w 1 "$NSAMPLES"); do
    /usr/sbin/screencapture -x -l"$(/usr/bin/osascript -e \
      'tell application "System Events" to set demoWindow to first window of (first process whose unix id is '"$DEMO_PID"')
       return id of demoWindow' 2>/dev/null || echo "")" "$OUT/screencapture/shot_${i}.png" 2>/dev/null || \
      /usr/sbin/screencapture -x "$OUT/screencapture/shot_${i}.png"
    sleep 0.1
  done
) &
SC_PID=$!

(
  for i in $(seq -w 1 "$NSAMPLES"); do
    python3 "$GAMEDIR_PY" screenshot "$OUT/gamedir/shot_${i}.png" >/dev/null 2>&1 || true
    sleep 0.1
  done
) &
GD_PID=$!

wait "$SC_PID" "$GD_PID"

# Kill demo.
pkill -9 -f gseurat_demo 2>/dev/null || true

# The Game Director writes into the demo's CWD (build/macos-debug/); move
# whatever landed there into $OUT/gamedir for tidy inspection.
shopt -s nullglob
for f in "$(dirname "$DEMO")"/shot_*.png; do
  mv "$f" "$OUT/gamedir/"
done

echo ""
echo "=== results ==="
echo "screencapture (window or screen):"
ls -la "$OUT/screencapture/" | awk '/\.png/ {print $5, $NF}' | sort -n | head -20
echo "..."
ls -la "$OUT/screencapture/" | awk '/\.png/ {print $5, $NF}' | sort -n | tail -10
echo ""
echo "game director (swapchain copy):"
ls -la "$OUT/gamedir/" | awk '/\.png/ {print $5, $NF}' | sort -n | head -20
echo "..."
ls -la "$OUT/gamedir/" | awk '/\.png/ {print $5, $NF}' | sort -n | tail -10
echo ""
echo "GPU validation errors in demo log:"
grep -c "VkImageView 0x0" "$OUT/demo.log" || true
