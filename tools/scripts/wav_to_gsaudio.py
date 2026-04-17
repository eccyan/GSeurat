#!/usr/bin/env python3
"""Convert WAV files to .gsaudio (pre-baked float32 PCM with 32-byte header).

Usage:
    python3 tools/scripts/wav_to_gsaudio.py input.wav -o output.gsaudio
    python3 tools/scripts/wav_to_gsaudio.py dir/*.wav --output-dir dir/

Format:
    Offset  Size  Type        Field
    0       4     char[4]     magic "GSAU"
    4       4     uint32_le   version (1)
    8       4     uint32_le   sample_rate
    12      1     uint8       channels
    13      3     uint8[3]    reserved (0)
    16      8     uint64_le   frame_count
    24      8     uint8[8]    reserved (0)
    32+     N     float32[]   interleaved PCM (N = frame_count * channels * 4)
"""
import argparse
import struct
import sys
import wave
from pathlib import Path


def wav_to_gsaudio(wav_path: Path, out_path: Path) -> None:
    with wave.open(str(wav_path), "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        frames = w.getnframes()
        bps = w.getsampwidth()
        raw = w.readframes(frames)

    if bps == 2:
        import array
        samples = array.array("h", raw)
        pcm = [s / 32767.0 for s in samples]
    elif bps == 4:
        import array
        pcm = list(array.array("f", raw))
    else:
        raise ValueError(f"Unsupported sample width: {bps} bytes")

    total_samples = frames * ch
    assert len(pcm) == total_samples, f"Expected {total_samples} samples, got {len(pcm)}"

    with out_path.open("wb") as f:
        f.write(b"GSAU")
        f.write(struct.pack("<I", 1))
        f.write(struct.pack("<I", sr))
        f.write(struct.pack("<B", ch))
        f.write(b"\x00" * 3)
        f.write(struct.pack("<Q", frames))
        f.write(b"\x00" * 8)
        for s in pcm:
            f.write(struct.pack("<f", s))

    expected_size = 32 + total_samples * 4
    actual_size = out_path.stat().st_size
    assert actual_size == expected_size, \
        f"Size mismatch: expected {expected_size}, got {actual_size}"
    print(f"  {wav_path.name} -> {out_path.name} "
          f"({frames} frames, {ch}ch, {sr}Hz, {actual_size} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert WAV to .gsaudio")
    parser.add_argument("inputs", nargs="+", type=Path, help="Input WAV files")
    parser.add_argument("-o", "--output", type=Path, help="Output file (single input only)")
    parser.add_argument("--output-dir", type=Path, help="Output directory (batch mode)")
    args = parser.parse_args()

    if args.output and len(args.inputs) > 1:
        print("Error: -o can only be used with a single input", file=sys.stderr)
        return 1

    for inp in args.inputs:
        if args.output:
            out = args.output
        elif args.output_dir:
            out = args.output_dir / inp.with_suffix(".gsaudio").name
        else:
            out = inp.with_suffix(".gsaudio")
        wav_to_gsaudio(inp, out)

    return 0


if __name__ == "__main__":
    sys.exit(main())
