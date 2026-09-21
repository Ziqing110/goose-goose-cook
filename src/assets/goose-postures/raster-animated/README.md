# 原 PNG 画风的鹅动画

11 个状态，320×320 透明背景。原 PNG 作为每张生成图的参考，imagegen 生成每个状态 4 个动作帧，再切图、统一比例和对齐脚底，以 0→1→2→3→2→1 顺序循环。

- `webp/`：Animated WebP，直接用 `<img>` 自动播放。
- `sprites/`：1920×320 PNG，6 个等宽帧，可用 CSS 控制暂停和速度。
- `posters/`：静态首帧。
- `sources/`：原始生成的四帧图。
- `preview.html`：可暂停、调速、切换深色背景及对照原 PNG。

## 普通网页

把 webp 文件复制到你的静态资源目录：

```html
<img src="/assets/goose-g1-on-it.webp" width="96" height="96" alt="鹅在做饭">
```

Animated WebP 本身不提供暂停；需要暂停或遵守减少动态效果偏好时，用精灵图组件或静态 poster。

## React / Vite 项目

已提供 `src/components/RasterAnimatedGoose.jsx` 和同名 CSS：

```jsx
import RasterAnimatedGoose from './components/RasterAnimatedGoose';
<RasterAnimatedGoose pose="g1-on-it" size={120} />
<RasterAnimatedGoose pose={isSpeaking ? 'toque-left' : 'toque-idle'} size={96} />
```

组件支持 `pose`、`size`、`paused`、`speed`、`label`、`className`、`style`，支持系统减少动态效果。资源为固定原画颜色，不支持 SVG 那种 CSS 领巾换色。

这是四张生成帧的轻量循环，仍有轻微帧间线条和形体变化，并非原画逐像素绑定或高帧率骨骼动画。脚底已对齐，但各帧的脚部绘制不完全相同。没有替换应用内已有角色。
