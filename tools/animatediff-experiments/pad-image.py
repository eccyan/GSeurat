#!/usr/bin/env python3
"""Add margin around a PNG then resize back to target size.
Usage: pad-image.py input.png output.png margin [r g b] [target_size]
"""
import sys
from PIL import Image

input_path = sys.argv[1]
output_path = sys.argv[2]
margin = int(sys.argv[3])
r = int(sys.argv[4]) if len(sys.argv) > 4 else 128
g = int(sys.argv[5]) if len(sys.argv) > 5 else 128
b = int(sys.argv[6]) if len(sys.argv) > 6 else 128
target = int(sys.argv[7]) if len(sys.argv) > 7 else 512

img = Image.open(input_path)
new_w = img.width + margin * 2
new_h = img.height + margin * 2
mode = "RGBA" if img.mode == "RGBA" else "RGB"
fill = (r, g, b, 255) if mode == "RGBA" else (r, g, b)
padded = Image.new(mode, (new_w, new_h), fill)
padded.paste(img, (margin, margin))

# Resize back to target so AnimateDiff always works at 512x512
if new_w != target or new_h != target:
    padded = padded.resize((target, target), Image.LANCZOS)

padded.save(output_path)
print(f"{target}x{target}")
