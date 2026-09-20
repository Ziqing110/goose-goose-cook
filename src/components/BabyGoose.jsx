import React from 'react';
import manifest from '../assets/baby-goose-final/animated/manifest.json';
import './BabyGoose.css';

// The keyed sheets (scripts/key-baby-goose-alpha.py): the delivered
// sprites with their paper lifted, so a goose can stand on any ground.
const sheets = import.meta.glob('../assets/baby-goose-final/animated/sprites-alpha/*.png', { eager: true, import: 'default' });

/** Approved baby-goose raster art. Transparent background; no runtime dependencies. */
export default function BabyGoose({
  pose = 'g8-toque-neutral', size = 96, speed = 1, paused = false,
  label = '厨房小鹅', decorative = false, className = '', style,
}) {
  const key = manifest[pose] ? pose : 'g8-toque-neutral';
  const clip = manifest[key];
  if (!clip) return null;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return <span
    className={`kp-baby-goose ${className}`}
    role={decorative ? undefined : 'img'}
    aria-label={decorative ? undefined : label}
    aria-hidden={decorative || undefined}
    style={{
      width: size, height: size,
      backgroundImage: `url("${sheets[`../assets/baby-goose-final/animated/sprites-alpha/goose-${key}.png`]}")`,
      backgroundSize: `${clip.frames * 100}% 100%`,
      '--kp-baby-travel': `${100 * clip.frames / (clip.frames - 1)}%`,
      animationDuration: `${clip.duration / rate}ms`,
      animationTimingFunction: `steps(${clip.frames})`,
      animationPlayState: paused ? 'paused' : 'running',
      ...style,
    }}
  />;
}
