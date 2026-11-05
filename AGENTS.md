# Duck Score Motion（独立网页版）— 交接说明

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

## 协作约定

- **不要擅自推送到远程仓库**：除非用户明确同意，否则不要执行 `git push`，也不要自己配 remote、建远程仓库（`gh repo create … --push`）或开 PR。本地提交、构建、测试照做，任何远端动作先问。

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
- 断行处的游标：当同系统没有可插值的下一拍（下一拍属于另一个 staff system，或已是全曲最后一拍）时，`cursorFor` 让游标继续朝该行最右侧竖线（`VideoBeatBounds.lineEnd`）滑行，并**单纯地放慢**：从音符自然速度起按恒定减速度降到 `LINE_END_END_SPEED`（0.6×），切行时仍在滑行（不停住，也不要求冲到行尾）。整段是一条连续曲线，没有巡航/刹车拐点；**初速不得超过音符速度**——一旦“末音加速”或被设计成先慢后刹，观感就会被否掉。切行时刻严格等于下一行第一个音的 tick。
- 横向排版的相机（`HORIZONTAL_CAMERA_*`）与游标平滑/延迟补偿（`smoothCursorX`、`CURSOR_LOOKAHEAD_FACTOR`）是配套的，单独改一个容易出现抖动或整体滞后。
- 两种单行取景共用同一个基准缩放：`baseScale = scoreW / PAGE_SURFACE_WIDTH`（`PAGE_SURFACE_WIDTH = 1760 + 2*TILE_PADDING`，即页面渲染面的固定宽度≈1856；**不能用横向 VideoScore 的 `score.width`**，那是整条长谱面的宽度，会把横向缩到很小）。横向的镜头缩放 = `baseScale * zoom`（放大即裁切/平移）；页面（单行）的镜头 = `scoreW / score.width`（页面宽度适配，整行留在画布内），放大靠渲染 scale（= zoom，折成更少小节）。因此**相同 zoom 下滑块下两者谱表的线距完全一致**——这是用户明确要求的不变式；实测 200% 时两边五线谱线距 12.5px / 六线谱 18px 相同（两条谱之间的间距由 alphaTab 的 page 布局决定，会比横向小，属于布局差异）。改动任何一边的缩放公式都要同步另一边。页面模式不使用镜头缩放。
- 页面（单行）排版：底层渲染与「页面」完全相同（`renderVideoScore` 仍用 alphaTab Page，两者共用同一份 `VideoScore`）；区别只在取景。`layoutVideoCanvas(...).singleLine` 打开后仍用页面的**宽度适配**（整行必须留在画布内，不做横向裁切/平移），放大靠渲染 scale（工作台缩放滑块，25–400%）：scale 越大，每行容纳的小节越少（最多一行一小节），谱面随之变大。`scrollFor` 把当前行的**谱线中心**（`systemTop + systemH / 2`，即 `lineAlignedBounds` 的中心，兼顾五线谱与六线谱）钉在画面中央；`paintVideoFrame` 只把**谱面**裁到当前行的 band（游标不裁，保留上下溢出）。`VideoScore.systems` 是各 partial 去掉 `TILE_PADDING` 后的矩形，**只保留真正含谱线的 partial**——标题、调弦说明等没有谱线的 partial 不算行。相机每帧直接赋值（切行是硬切，不能有滚动/缓动）；游标在曲末消失的帧由调用方传入最后一行（`PaintFrame.systemTop`），否则会掉到没有谱线的 partial 上。主界面播放器用的是 alphaTab 自带滚动，仍是完整页面，面板里有提示。
- 无内嵌音频的谱子：视频工作台照常可用（不要求 `playerReady`；`openStudio` 会同步 `loadMidiForScore()` 建好 tick cache）。时长取自谱面自己的速度表（`scoreTimelineMs`，按 master bar 的 tempo automation 积分），预览用 alphaTab 合成器实时播放（`api.play()`，强制 1.0 倍速、无节拍器/预备拍/循环），所以速度严格等于谱面 BPM。导出时若没有音轨，会先用 `synthesizeScoreAudio()` 把谱面渲染成 16-bit WAV（alphaTab `exportAudio` + `useSyncPoints: false`，严格按谱面 BPM），再以恒等 syncPoints 交给 `renderOfflineVideo`；合成失败则提示并回退为无声导出。**注意**：`exportAudio` 的 worker 用 `importScripts` 加载脚本，`core.scriptFile` 必须指向 classic 构建 `assets/alphaTab.worker.js`——指到 ESM 的 `alphaTab.mjs` 会让 worker 报语法错误、`initialize()` 永久挂起。
- 合成器输出的缓冲时长（`settings.player.bufferTimeInMilliseconds`）必须 ≥ 350 ms，用默认的 500。alphaTab 的 ScriptProcessor 输出每次回调消费 4096 帧（8192 个交织样本），但 `_requestBuffers` 只维持「半个缓冲区」在途（每次请求 2048 帧）；配成 200 ms 时缓冲区总量只有 2×2048 帧，于是每次回调都有一半是空的——听感是**恒定 0.5 倍速 + 持续爆音**，`api.timePosition` 也只走一半（`_onSamplesPlayed` 只按实际取到的样本推进），预览的画面和声音一起变慢。这个坑对主播放器和视频工作台同时生效，只有内嵌伴奏（走 `<audio>`/backing track 输出）不受影响。
- 视频工作台侧栏 `.gsp-vs-fieldset` 是 `fieldset`，UA 默认 `min-width: min-content`，不会收缩；只要有一行不能换行（例如把整句提示塞进单行的 `.gsp-chip`），侧栏就会被撑到 430+ px 并推出屏幕右侧。CSS 里已显式 `min-width: 0`；**长句只能用 `.gsp-hint` 段落**，chip 只放短标签（如 `studio.midiSource`）。
- **初级预览（播放器）与视频工作台的排版是两套独立状态**：`playerLayout`（`core/index.tsx`）驱动播放器的 alphaTab 实例，`studioLayout` 只喂给工作台自己的 `renderVideoScore`。`applyStudioLayout` 只 setState，绝不碰 `apiRef.current.settings.display`，否则在工作台里调排版会把播放器也一起改掉（用户明确要求「工作台里改的设置不同步回初级预览」）。播放器默认 `页面 + 100%`（`DEFAULT_PLAYER_LAYOUT`，`defaultPlayerLayout()`），工作台默认仍是 `横向 175%`（`DEFAULT_LAYOUT`，`defaultLayout()`）；两者的 sanitize 用各自的 default 作为兜底值。播放器的排版下拉只给 `页面 / 横向`——`页面（单行）` 是工作台取景，播放器没有这个概念。**谱表（五线谱/六线谱）和小节宽度仍是共享的**：前者是谱面内容（还会随曲谱自动探测），后者是逐小节数据，不属于排版记忆。
- 设置存在 localStorage：`gp-score-player.layout.v1`（播放器排版）、`gp-score-player.studio.v1`（工作台画布 + 工作台排版）、`gp-score-player.export.v1`（导出参数）；无存档时用 `DEFAULT_*` 常量。改默认值只影响新用户。
- 主题（白底/黑底）只改纸面、谱面与文字，游标颜色独立。
- **署名**：alphaTab 的「♪ alphaTab.net」谱面署名必须保留可见，不得删除、遮挡、裁剪或改渲染结果（<https://alphatab.net/docs/attribution>）。表头/右下角的「Powered by alphaTab」是补充署名。

## 品牌（网站标题 / logo）

- **站点名只有一处**：`index.html` 的 `<title>` 与 `<meta name="description">`（`theme-color` 也在那里）。不要在 TS / i18n 里再写一份站点名，否则换标题要改多处。
- **logo 是静态文件**：放在 `brand/`（`favicon.svg` 精简版、`favicon-32.png` 兜底、`apple-touch-icon.png` 不透明 180、`icon-512.png`、`logo.svg` 完整插画），`scripts/build.mjs` 整目录拷到 `dist/brand/`，`index.html` 用相对路径引用（Pages 子路径下同样有效）。换图标 = 覆盖同名文件后重新构建，不用改代码；生成方法与绘图要求见 `brand/README.md`。
- 若之后要放词标/页内标记，优先放空状态 `.gsp-empty-icon` 或工作台顶栏 `.gsp-vs-top`，尺寸与主色参考 `--gsp-accent`（#436d9d）；深色主题（`.gsp-root.is-studio` 与黑底画布）需要能看清。
- 任何 logo 都不能遮挡或替换 alphaTab 的「♪ alphaTab.net」署名（见下）。
- **命名**：显示名 **Duck Score Motion**（`index.html` 的 `<title>` 就是这四个词，说明放 `<meta name="description">`），仓库 `duckscore-motion`，部署在仓库的 Pages（地址即 `<owner>.github.io/<repo>/`，**不要在 README 等公开文档里写出来**）。对外文案已统一；**内部标识不改**：`gp-score-player.*` 三个 localStorage key、`[gp-studio]` 日志前缀、`gsp-` CSS 前缀、`plugins/gp-score-player/` 兜底路径——改 key 会丢用户设置。

## 打包 Electron（未做）

1. `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`（必须在 `app.whenReady` 之前）。
2. `protocol.handle('app', …)` 把 `app://gp/` 映射到 `dist/`，然后 `win.loadURL('app://gp/index.html')`。
3. 资源路径无需改：`dist/assets/` 与 `app://gp/assets/` 同源。
4. 可选：`showOpenDialog` / `showSaveDialog`、内置 ffmpeg 转 MP4。

## 已知坑

- `dist/app.js` ≈ 2 MB；`dist/assets` 含字体与音色库。
- 组件 CSS 自带注入；新增主题变量时同步补 `src/app.css` 里的 `--dsw-alias-*` 兜底。
