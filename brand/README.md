# 站点品牌资源

`scripts/build.mjs` 会把本目录原样复制到 `dist/brand/`，`index.html` 用相对路径引用，
所以在 GitHub Pages 的子路径（`/<repo>/`）下也能正常加载。

## 现有文件

| 文件 | 用途 | 要求 |
|---|---|---|
| `favicon.svg` | 浏览器标签页图标 | 方形，带 `viewBox`，16–32 px 下仍可辨认；建议单色/双色 |

## 替换 logo 时

1. 覆盖 `brand/favicon.svg`（或新增 `brand/logo.svg` 作为界面内的标记），无需改代码。
2. 重新 `npm run build`。
3. 如果要换网站标题，只改 `index.html` 里的 `<title>` 和 `<meta name="description">`——
   站点名**只有这一处**，不要在 TS/i18n 里再写一份。

## 绘制约定（给 logo 设计）

- 优先交付 SVG（纯矢量、无外链字体、无 `<style>` 内嵌 CSS 更稳），或 512×512 的 PNG。
- 方形图标在内边距里留 ~10% 安全区；深色/浅色界面都要能看清（当前主题底色 `#436d9d` 蓝、纸面 `#fff`）。
- 词标（wordmark）请另外给一份横向版本，宽度比约 4:1，随后再决定放在空状态还是工作台顶栏。
