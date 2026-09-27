# Baby goose referee v1
Generated with built-in image_gen; prompts in prompt.txt.

- referee-countdown.webp: 256×384, four frames, durations 1000/1000/1000/700ms, looping. White background, no audio or baked-in digits.
- referee-sheet.png: 2048×768, four equal cells, ordered 3/2/1/GO.
- referee-3.png, referee-2.png, referee-1.png, referee-go.png: individual 256×384 frames.
- preview.html: play/pause/frame selection/download. Open directly or through Vite.

For actual match countdowns use individual frames or sheet and the same timer/state as the displayed digits and match start; do not control match start from a looping WebP. Sprite aspect ratio 2:3, background-size 400% 100%, positions 0%,33.333333%,66.666667%,100%.
Four held keyframes, not fully in-betweened motion; small generated shape variation remains. Existing match UI unchanged.
