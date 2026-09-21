import React from 'react';

const files = import.meta.glob('../assets/goose-postures/animated/*.svg', {
  query: '?raw', import: 'default', eager: true,
});

/** Native animated SVG. No animation package, network calls, or timers. */
export default function AnimatedGoose({
  pose = 'toque-idle', size = 96, color, ink = '#171717',
  paused = false, speed = 1, label, className, style,
}) {
  const source = files[`../assets/goose-postures/animated/goose-${pose}.svg`]
    || files['../assets/goose-postures/animated/goose-toque-idle.svg'];
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return (
    <span
      className={className}
      role="img"
      aria-label={label || pose.replaceAll('-', ' ')}
      style={{
        display: 'inline-block', width: size, height: size, lineHeight: 0,
        '--kp-cook-a': color || (pose.startsWith('toque') ? '#7C5CE0' : '#E58A1F'),
        '--goose-ink': ink,
        '--goose-tempo': 1 / safeSpeed,
        '--goose-play-state': paused ? 'paused' : 'running',
        ...style,
      }}
    >
      <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: source }} />
    </span>
  );
}
