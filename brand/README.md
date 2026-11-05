# 站点品牌资源

`scripts/build.mjs` 会把本目录原样复制到 `dist/brand/`，`index.html` 用相对路径引用，
所以在 GitHub Pages 的子路径（`/<repo>/`）下也能正常加载。

## 文件

| 文件 | 用途 | 说明 |
|---|---|---|
| `favicon.svg` | 浏览器标签页图标（首选） | 32px 下仍可辨认的精简版：无投影、加粗描边、鸭子放大 |
| `favicon-32.png` | 标签页图标（SVG 不受支持时的兜底） | 32×32，透明背景 |
| `apple-touch-icon.png` | iOS 添加到主屏幕 / Safari 书签 | 180×180，不透明浅底（iOS 会套圆角遮罩） |
| `icon-512.png` | 仓库社交预览、README、其它 512px 用途 | 透明背景 |
| `logo.svg` | 原始完整插画（渐变 + 投影） | 后续做空状态大图或导出水印时用它，小尺寸不要用 |

`favicon.svg` 是从 `logo.svg` 派生的：去掉 `feDropShadow`（小尺寸会糊成灰边）、
描边 6→10、鸭子放大到 1.12 倍、配色加深一档。改插画时两者要一起更新。

## 换 logo 的步骤

1. 覆盖 `logo.svg`（完整版）与 `favicon.svg`（精简版），重新 `npm run build`；
   PNG 兜底图按同样尺寸重出（`favicon-32.png` 32×32、`apple-touch-icon.png` 180×180
   不透明、`icon-512.png` 512×512）。
2. 要换网站标题，只改 `index.html` 的 `<title>` 与 `<meta name="description">`——
   站点名**只有这一处**，不要在 TS/i18n 里再写一份。
3. 站点名已统一为 `Duck Score Motion`（见 `AGENTS.md` 的命名一节）。

## 绘制约定

- 优先 SVG（纯矢量、无外链字体、无内嵌 `<style>`）；方形图标留 ~10% 安全区。
- 深色/浅色界面都要能看清：主色参考 `--gsp-accent`（#436d9d），图标本体是浅蓝 + 鸭黄。
- 词标（wordmark）另给横向版本，宽度比约 4:1，再决定放到空状态还是工作台顶栏。
