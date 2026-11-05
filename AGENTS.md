# GP Studio（独立网页版）— 交接说明

自包含目录，不依赖上级仓库。业务代码在 `core/`，外壳在 `src/`。

## 运行

```bash
npm install
npm start                  # build + serve → http://127.0.0.1:4173/
npm run build              # 只构建到 dist/
npm run serve              # 只起服务（需先 build）
npm run typecheck          # tsc --noEmit
```

必须用 http 访问，不能用 `file://`。导出依赖 WebCodecs → Chrome / Edge。

## 结构

- `core/index.tsx` — `Player` 组件 + `configureAssets()`
- `core/video.ts` — 谱面栅格化、画布布局、游标、相机
- `core/video-studio.tsx` — 视频工作台
- `core/offline-export.ts` — WebCodecs 离线导出
- `core/studio-types.ts` / `core/studio-storage.ts` — 设置类型、默认值、localStorage
- `core/score-style.ts` — 字体 / 配色 / 第二声部
- `core/i18n.ts` — 中英文案
- `src/main.ts` — 唯一与宿主相关的部分（React 绑定、语言、资源路径）

## 改代码前必读

- 预览与离线导出共用 `layoutVideoCanvas` / `paintVideoFrame`，任何视觉改动必须两边一致，只允许分辨率/帧率不同。
- 游标纵向范围取自 `masterBarBounds.lineAlignedBounds`（谱线范围，不是含文字的 visualBounds）；改成 visualBounds 会让游标伸进上方的文字。
- 横向排版的相机（`HORIZONTAL_CAMERA_*`）与游标平滑/延迟补偿（`smoothCursorX`、`CURSOR_LOOKAHEAD_FACTOR`）是配套的，单独改一个容易出现抖动或整体滞后。
- 设置存在 localStorage：`gp-score-player.studio.v1`、`gp-score-player.export.v1`；无存档时用 `DEFAULT_*` 常量。改默认值只影响新用户。
- 主题（白底/黑底）只改纸面、谱面与文字，游标颜色独立。
- **署名**：alphaTab 的「♪ alphaTab.net」谱面署名必须保留可见，不得删除、遮挡、裁剪或改渲染结果（<https://alphatab.net/docs/attribution>）。表头/右下角的「Powered by alphaTab」是补充署名。

## 打包 Electron（未做）

1. `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`（必须在 `app.whenReady` 之前）。
2. `protocol.handle('app', …)` 把 `app://gp/` 映射到 `dist/`，然后 `win.loadURL('app://gp/index.html')`。
3. 资源路径无需改：`dist/assets/` 与 `app://gp/assets/` 同源。
4. 可选：`showOpenDialog` / `showSaveDialog`、内置 ffmpeg 转 MP4。

## 已知坑

- `dist/app.js` ≈ 2 MB；`dist/assets` 含字体与音色库。
- 组件 CSS 自带注入；新增主题变量时同步补 `src/app.css` 里的 `--dsw-alias-*` 兜底。
