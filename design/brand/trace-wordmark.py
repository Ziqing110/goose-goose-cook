"""Outline-trace only the selected original lettering. Never a small icon source."""
from pathlib import Path
import cv2

root = Path(__file__).resolve().parents[2]
source = root / 'design/goose-goose-cook-logo-options/chef-goose-baguette-doodle-v2.png'
img = cv2.imread(str(source), cv2.IMREAD_GRAYSCALE)
# Preserve the actual hand-lettering; exclude the entire goose above y=1060.
mask = (img[1060:1185, :] < 140).astype('uint8') * 255
contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
parts = []
for contour in contours:
    if abs(cv2.contourArea(contour)) < 3:
        continue
    points = cv2.approxPolyDP(contour, .45, True).reshape(-1, 2)
    parts.append('M' + ' L'.join(f'{x},{y}' for x, y in points) + ' Z')
(root / 'design/brand/wordmark-paths.svg').write_text(
    '<path fill="currentColor" stroke="currentColor" stroke-width="0" fill-rule="evenodd" d="' + ' '.join(parts) + '"/>\n'
)
