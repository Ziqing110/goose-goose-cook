# Animated goose assets

11 transparent, self-contained animated SVG files. These animate the native SVG redraws, not the generated raster sheets. No external libraries, JavaScript, fonts, or raster images are required. Feet, burners and counters remain fixed. Reduced-motion preferences disable animation.

## Any website

Copy an SVG to your public assets directory:

```html
<img src="/assets/goose-toque-left.svg" width="96" height="96" alt="Toque speaking" />
```

The image animates automatically. Default clothing: orange for players, purple for Toque. External `<img>` SVGs cannot inherit the page's CSS variables; inline the SVG or use the React component to change colours and pause playback.

## This React / Vite project

```jsx
import AnimatedGoose from './components/AnimatedGoose';

<AnimatedGoose pose="g1-on-it" size={96} />
<AnimatedGoose pose="g4-free-hands" color="#458CCC" />
<AnimatedGoose pose="toque-left" paused={!isSpeaking} speed={1} />
```

For a silent agent, switch `pose` to `toque-idle`; `paused` freezes the current frame. `speed` is a positive multiplier. `label` supplies an accessible name. Blue #458CCC is a preview colour and can be replaced with your project's Mia token. Keep `ink` dark against the white body in both themes.

Available poses: g1-on-it, g2-up-next, g3-waiting, g4-free-hands, g5-done-for-the-night, g6-up-for-grabs, g7-honk, g9-victory, toque-idle, toque-left, toque-right.

Open `../animated-preview.html` to review all poses at large size, 32px and 48px, with play/pause, speed, clothing colour and background controls.

Regenerate assets with `python3 scripts/build-goose-animations.py` from the project root. Existing application screens are not modified.
