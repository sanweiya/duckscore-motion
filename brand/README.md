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
2. 按上节重出 `build/` 下的桌面图标（ico / icns / 多尺寸 png），否则安装包还是旧图。
2. 要换网站标题，只改 `index.html` 的 `<title>` 与 `<meta name="description">`——
   站点名**只有这一处**，不要在 TS/i18n 里再写一份。
3. 站点名已统一为 `Duck Score Motion`（见 `AGENTS.md` 的命名一节）。

## 桌面打包图标（仓库根的 `build/`）

桌面安装包的图标跟着上面两个 SVG 走，但**按尺寸分段取源**：小尺寸用
`favicon.svg`（无投影、描边粗、鸭子放大，缩到 16px 仍可辨认），大尺寸用
`logo.svg`（完整插画）。放在 `build/` 而不是本目录，是为了不让网页构建把这
几百 KB 拷进 `dist/`。

| 文件 | 来源 | 用途 |
|---|---|---|
| `build/icons/16x16.png` … `128x128.png` | `favicon.svg` | 小尺寸（Linux hicolor、ico/icns 小槽位） |
| `build/icons/256x256.png` … `1024x1024.png` | `logo.svg` | 大尺寸（Linux、ico/icns 大槽位） |
| `build/icon.ico` | 上两行混合 | Windows 安装包（16–256，七个尺寸） |
| `build/icon.icns` | 上两行混合 | macOS 安装包（16–1024，`icp4…ic10`） |

这些是**已提交的静态资产**，只在换 logo 时重出：用 librsvg 渲染（本机可走
ffmpeg 的 `librsvg` 解码器——把 SVG 的 `width`/`height` 换成目标像素、`viewBox`
保持不变），再用 Pillow 之类把各尺寸打包成 ico/icns。`electron-builder` 对
`.ico`/`.icns` 是原样使用、不再转换，所以两个源各管一段尺寸才有效。

**不要用 `icon-512.png` 上采样当大图标**：小尺寸会糊，`favicon.svg` 存在的
意义就是给这些槽位。

## 绘制约定

- 优先 SVG（纯矢量、无外链字体、无内嵌 `<style>`）；方形图标留 ~10% 安全区。
- 深色/浅色界面都要能看清：主色参考 `--gsp-accent`（#436d9d），图标本体是浅蓝 + 鸭黄。
- 词标（wordmark）另给横向版本，宽度比约 4:1，再决定放到空状态还是工作台顶栏。
