import React from 'react';
import manifest from '../assets/goose-postures/raster-animated/manifest.json';
import './RasterAnimatedGoose.css';

const sprites = import.meta.glob('../assets/goose-postures/raster-animated/sprites/*.png', { eager: true, import: 'default' });

export default function RasterAnimatedGoose({ pose = 'toque-idle', size = 96, paused = false, speed = 1, label, className = '', style }) {
  const selected = manifest[pose] ? pose : 'toque-idle';
  const state = manifest[selected];
  const sprite = sprites[`../assets/goose-postures/raster-animated/sprites/goose-${selected}.png`];
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return <span role="img" aria-label={label || selected.replaceAll('-', ' ')} className={`kp-raster-goose ${className}`} style={{ width: size, height: size, backgroundImage: `url("${sprite}")`, animationDuration: `${state.duration / rate}ms`, animationPlayState: paused ? 'paused' : 'running', ...style }} />;
}
