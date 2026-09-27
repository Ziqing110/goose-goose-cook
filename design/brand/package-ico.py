"""Package independently rendered sizes, never derive 16px from the 32px art."""
from pathlib import Path
import struct
from PIL import Image
root = Path(__file__).resolve().parents[2]
frames = [(size, (root / f'design/brand/qa/ico-{size}.png').read_bytes()) for size in (16,32,48)]
offset = 6 + 16 * len(frames)
entries = []
for size, data in frames:
    entries.append(struct.pack('<BBBBHHII',size,size,0,0,1,32,len(data),offset))
    offset += len(data)
(root/'public/favicon.ico').write_bytes(struct.pack('<HHH',0,1,3)+b''.join(entries)+b''.join(data for _,data in frames))
ico = Image.open(root/'public/favicon.ico')
assert ico.ico.sizes() == {(16,16),(32,32),(48,48)}
for size, _ in frames:
    frame = ico.ico.getimage((size,size)).convert('RGBA')
    assert frame.tobytes() == Image.open(root/f'design/brand/qa/ico-{size}.png').convert('RGBA').tobytes()
for name, size in [('apple-touch-icon.png',(180,180)),('og-image.png',(1200,630))]:
    img=Image.open(root/'public'/name).convert('RGBA')
    assert img.size == size and img.getextrema()[3] == (255,255)
    assert img.getpixel((0,0)) == (255,255,255,255)
print('PASS: ICO frames exact 16/32/48; Apple and OG sizes, opacity and white ground')
