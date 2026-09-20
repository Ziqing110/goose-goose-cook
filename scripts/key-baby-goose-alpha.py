"""Key the white background out of the approved baby-goose sprite sheets.

The delivered sheets (assets/baby-goose-final/animated/sprites) are opaque
white, which reads as a white tile wherever a goose stands on anything
but white. This keeps the drawing untouched and only lifts the paper:
the background is the white region connected to the sheet's edges (the
goose's own white body is sealed inside its outline, so it stays), and
its anti-aliased rim becomes partial alpha rather than a grey halo.

Output: animated/sprites-alpha/<same name>.png, which BabyGoose uses.
"""
from collections import deque
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "src/assets/baby-goose-final/animated"
OUT = BASE / "sprites-alpha"
# A pixel this light may be paper; lighter than SOLID is paper for sure.
PAPER = 190
SOLID = 246


def key(src: Path, dst: Path):
    im = Image.open(src).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    light = a[:, :, :3].min(axis=2) >= PAPER
    # Flood from every edge pixel through light pixels.
    seen = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if light[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if light[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and light[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    # In the paper region: how much ink is on the pixel becomes alpha,
    # and the colour becomes that ink (dark) so it composites cleanly.
    lum = a[:, :, :3].min(axis=2).astype(np.float32)
    alpha = np.clip((SOLID - lum) / (SOLID - PAPER), 0, 1)
    alpha[~seen] = 1
    out = a.copy()
    out[:, :, 3] = (alpha * 255).round().astype(np.uint8)
    rim = seen & (alpha > 0)
    out[rim, 0:3] = 26  # the system's ink
    Image.fromarray(out).save(dst, optimize=True)


OUT.mkdir(exist_ok=True)
for src in sorted((BASE / "sprites").glob("*.png")):
    key(src, OUT / src.name)
    print(src.name)
