# Baby goose 网页动画

这是最终批准的小头、紧凑肚子、两瓣低伏绒羽版本，共 16 个动作。白底，不透明。独立静态姿态原图保留在上一级 `png/`。

## 最简单：WebP

把 `webp/` 中需要的文件复制到网页静态资源目录：

```html
<img src="/assets/goose-g1-on-it.webp" width="96" height="96" alt="小鹅正在做饭">
```

每张 320×320，自动循环，不依赖动画库。WebP 不能通过 CSS 暂停，也不会自动遵守系统减少动态效果设置；需要这些功能时用下面的组件或静态首帧。

## 本项目 React / Vite

```jsx
import BabyGoose from './components/BabyGoose';

<BabyGoose pose="g1-on-it" size={96} label="正在做饭" />
<BabyGoose pose={isSpeaking ? 'g8x-toque-speaking-left' : 'g8-toque-neutral'} />
<BabyGoose pose="g10-walking" size={64} speed={1.2} paused={false} />
```

组件及样式在 `src/components/BabyGoose.jsx`、`BabyGoose.css`。ZIP 保留项目路径，合并到项目同名目录即可。组件使用 PNG 精灵图，支持 `pose`、`size`、`speed`、`paused`、`label`、`decorative`、`className`、`style`。系统减少动态效果开启时停留首帧。`paused` 冻结当前帧，静止待命请切换到 `g8-toque-neutral`。不支持 CSS 改领巾颜色。

## 文件

- `webp/`：16 张自动循环动图。
- `sprites/`：横向等宽 PNG 精灵图；每格 320×320。
- `posters/`：静态首帧。
- `manifest.json`：每个动作的帧数、帧时长、文件路径。
- `preview.html`：播放、暂停、调速、32px/64px 样例和原图对照。
- `sources/`：生成的原始四帧图，保留在项目中，不放进轻量下载包。

动作名：g1-on-it, g2-up-next, g3-waiting, g4-free-hands, g5-done-for-the-night, g6-eyeing-the-offer, g7-due-honk, g8-toque-neutral, g8x-toque-speaking-left, g8y-toque-calling-right, g9-victory, g10-walking, g11-handoff, g12-behind-plan, g13-listening, g14-defeat-good-game。

每个动作由 4 张生成帧组成。走路按 4 帧顺序循环，其余按 0,1,2,3,2,1 往返播放；Toque 右侧是左侧逐帧镜像。属于轻量逐帧动画，可能有轻微线条或形体变化，不是原图骨骼绑定。白底保留轻微生成色差。现有应用页面未替换。
