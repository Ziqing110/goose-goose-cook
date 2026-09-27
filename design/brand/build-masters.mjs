import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { body, cuts, wings, head, head16 } from './geometry.mjs';
const dir = new URL('./', import.meta.url);
const root = new URL('../../', dir);
const shape = d => `<path d="${d}" fill="var(--kp-bg, #fff)" stroke="currentColor"/>`;
const line = d => `<path d="${d}" fill="none" stroke="currentColor"/>`;
const eye = (x,y,r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const goose = stroke => `<g stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round">${body.map(shape).join('')}${cuts.map(line).join('')}${wings.map(line).join('')}${eye(163,123,6)}${eye(190,124,6)}</g>`;
const face = (tiny=false, favicon=false) => `<g stroke-width="${tiny?1.5:2}" stroke-linecap="round" stroke-linejoin="round">${(tiny?head16:head).map(shape).join('')}<g${favicon?' style="color:#1a1a1a"':''}>${tiny?eye(9.5,9,0.85):eye(16.5,18,1)+eye(21,18.3,1)}</g></g>`;
const svg = (box, inner, style='') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" color="#1a1a1a">${style}${inner}</svg>\n`;
await mkdir(new URL('public/',root),{recursive:true});
// Non-scaling strokes keep M at 2px throughout its 96–400px display range.
await writeFile(new URL('goose-mark.svg',dir),svg('0 0 360 830',goose(2).replaceAll('<path ', '<path vector-effect="non-scaling-stroke" ')));
await writeFile(new URL('goose-head.svg',dir),svg('0 0 32 32',face()));
await writeFile(new URL('goose-head-16.svg',dir),svg('0 0 16 16',face(true)));
const wordmark = await readFile(new URL('wordmark-paths.svg',dir),'utf8');
// L retains the source's 7–8px stroke at roughly 1402px canvas height.
await writeFile(new URL('goose-lockup.svg',dir),svg('0 0 1122 1402',`<g transform="translate(382 226)">${goose(7.5)}</g><g transform="translate(0 1060)">${wordmark}</g>`));
await writeFile(new URL('og-layout.svg',dir),svg('0 0 1200 630',`<rect width="1200" height="630" fill="var(--kp-bg, #fff)"/><g transform="translate(85 30) scale(.68)">${goose(7.5)}</g><g transform="translate(228 228) scale(.85)">${wordmark}</g>`));
await writeFile(new URL('public/favicon.svg',root),svg('0 0 32 32',`<g class="regular">${face(false,true)}</g><g class="tiny" transform="scale(2)">${face(true,true)}</g>`,'<style>:root{color:#1a1a1a;--kp-bg:#fff}.tiny{display:none}@media(prefers-color-scheme:dark){:root{color:#f7f6f3}}@media(max-width:20px){.regular{display:none}.tiny{display:inline}}</style>'));
// Generate inline React from the same S master: no second hand-maintained drawing.
const jsx = face().replaceAll('stroke-width','strokeWidth').replaceAll('stroke-linecap','strokeLinecap').replaceAll('stroke-linejoin','strokeLinejoin');
const markJsx = goose(2).replaceAll('<path ', '<path vectorEffect="non-scaling-stroke" ').replaceAll('stroke-width','strokeWidth').replaceAll('stroke-linecap','strokeLinecap').replaceAll('stroke-linejoin','strokeLinejoin');
await writeFile(new URL('src/components/BrandGoose.jsx',root),`// Generated from design/brand/geometry.mjs via build-masters.mjs.\nexport default function BrandGoose() {\n  return <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">${jsx}</svg>;\n}\nexport function BrandGooseMark({ size = 120, className = "" }) {\n  return <svg className={className} viewBox="0 0 360 830" width={size * 360 / 830} height={size} style={{ color: "var(--kp-text, #1a1a1a)", flexShrink: 0 }} aria-hidden="true" focusable="false">${markJsx}</svg>;\n}\n`);
