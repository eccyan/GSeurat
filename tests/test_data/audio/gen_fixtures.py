#!/usr/bin/env python3
"""Generate deterministic audio test fixtures.

Run from repo root:
    python3 tests/test_data/audio/gen_fixtures.py

Outputs:
    sine_loop.wav  — 0.5s mono 48kHz, 480Hz sine with INTEGER cycle count
                     so loop wrap produces zero discontinuity.
    dc_unity.wav   — 0.5s mono 48kHz, constant 0.5 float samples.
                     Makes slew assertions trivial (output == gain * 0.5).
"""
import math
import struct
import sys
from pathlib import Path

SAMPLE_RATE = 48000
DURATION_SEC = 0.5
FRAMES = int(SAMPLE_RATE * DURATION_SEC)  # 24000
FREQ_HZ = 480.0  # 24000 / 50 cycles — exactly 50 full cycles in 0.5s

OUT_DIR = Path(__file__).parent


def write_wav_pcm16_mono(path: Path, samples: list[float]) -> None:
    """Write a 16-bit PCM mono WAV."""
    n = len(samples)
    byte_rate = SAMPLE_RATE * 2  # mono, 16-bit
    with path.open("wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + n * 2))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, SAMPLE_RATE, byte_rate, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", n * 2))
        for s in samples:
            v = max(-1.0, min(1.0, s))
            f.write(struct.pack("<h", int(v * 32767)))


def main() -> int:
    # sine_loop.wav — 480Hz sine, 50 full cycles in 0.5s
    sine = [math.sin(2 * math.pi * FREQ_HZ * i / SAMPLE_RATE) for i in range(FRAMES)]
    write_wav_pcm16_mono(OUT_DIR / "sine_loop.wav", sine)

    # dc_unity.wav — constant 0.5 (survives int16 round-trip cleanly)
    dc = [0.5] * FRAMES
    write_wav_pcm16_mono(OUT_DIR / "dc_unity.wav", dc)

    print(f"Wrote {OUT_DIR / 'sine_loop.wav'} ({FRAMES} frames)")
    print(f"Wrote {OUT_DIR / 'dc_unity.wav'} ({FRAMES} frames)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
