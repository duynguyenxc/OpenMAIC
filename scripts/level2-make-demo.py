#!/usr/bin/env python3
"""
Build an animated GIF walkthrough from browser screenshots.

Frames are the screenshots the browser pane already saves to disk; this adds a
caption bar under each one so the recording explains itself, and holds each
frame long enough to read.
"""
import sys, json
from PIL import Image, ImageDraw, ImageFont

BAR = 76
W = 960
BG = (255, 255, 255)
INK = (24, 24, 27)
MUTED = (113, 113, 122)
ACCENT = (124, 58, 237)

def font(size, bold=False):
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

F_TITLE = font(23, bold=True)
F_SUB = font(16)
F_STEP = font(13, bold=True)

def frame(path, step, title, subtitle):
    shot = Image.open(path).convert("RGB")
    scale = W / shot.width
    shot = shot.resize((W, int(shot.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGB", (W, shot.height + BAR), BG)
    canvas.paste(shot, (0, 0))
    d = ImageDraw.Draw(canvas)
    y = shot.height
    d.rectangle([0, y, W, y + BAR], fill=(250, 250, 252))
    d.rectangle([0, y, W, y + 3], fill=ACCENT)
    d.text((28, y + 16), step, font=F_STEP, fill=ACCENT)
    d.text((28, y + 36), title, font=F_TITLE, fill=INK)
    if subtitle:
        d.text((28 + F_TITLE.getlength(title) + 16, y + 42), subtitle, font=F_SUB, fill=MUTED)
    return canvas

def main(spec_path, out_path):
    spec = json.load(open(spec_path))
    frames, holds = [], []
    size = None
    for item in spec:
        img = frame(item["image"], item["step"], item["title"], item.get("subtitle", ""))
        if size is None:
            size = img.size
        elif img.size != size:
            padded = Image.new("RGB", size, BG)
            padded.paste(img, (0, 0))
            img = padded
        frames.append(img)
        holds.append(int(item.get("hold", 3)) * 1000)   # seconds on screen
    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                   duration=holds, loop=0, optimize=True)
    print(f"wrote {out_path}  ({len(frames)} steps, {sum(holds)/1000:.0f}s)")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
