# core/ — 业务代码约束

`core/` 是全部业务代码：播放器、视频工作台、谱面渲染、导出、i18n、样式。
下面每条都是踩过坑换来的，改对应文件前先读。

## 谱面渲染与排版（`video.ts` / `video-studio.tsx`）

- 游标纵向范围取 `masterBarBounds.lineAlignedBounds`（谱线范围），**不要用
  `visualBounds`**——否则游标会伸进上方的文字。
- 行尾游标：同系统没有可插值的下一拍时，`cursorFor` 让游标朝该行最右侧竖线
  （`VideoBeatBounds.lineEnd`）滑行并**单纯放慢**：从音符自然速度起按恒定减速度降到
  `LINE_END_END_SPEED`（0.6×），切行时仍在滑行。整段是一条连续曲线，没有巡航/刹车拐点；
  **初速不得超过音符速度**（“末音加速”或先慢后刹都会被否），切行严格等于下一行首拍 tick。
- 横向相机 `HORIZONTAL_CAMERA_*` 与游标平滑 `smoothCursorX`、`CURSOR_LOOKAHEAD_FACTOR`
  是配套的，单独改一个会抖或整体滞后。
- 两种单行取景共用基准缩放：`baseScale = scoreW / PAGE_SURFACE_WIDTH`
  （`1760 + 2*TILE_PADDING` ≈ 1856），**不能用横向的 `score.width`**（那是整条长谱面）。
  横向镜头缩放 = `baseScale * zoom`（放大即裁切/平移）；页面（单行）镜头 =
  `scoreW / score.width`（整行留在画布内），放大靠渲染 scale。
  **同一 zoom 下两者谱表线距必须一致**（实测 200%：五线谱 12.5px / 六线谱 18px）；
  改任一边都要同步另一边。页面模式不使用镜头缩放。
- 页面（单行）：渲染与「页面」完全相同，只改取景。`singleLine` 仍按宽度适配，
  放大 = 渲染 scale（25–400%，越大每行越少小节，最多一行一小节）。
  `scrollFor` 把当前行的**谱线中心**（`systemTop + systemH/2`，兼顾五线谱/六线谱）钉在画面
  中央；`paintVideoFrame` 只把**谱面**裁到 band（游标不裁，保留上下溢出）。
  `VideoScore.systems` 只保留真正含谱线的 partial（标题、调弦说明不算行）。
  切行是硬切，每帧直接赋值，不能有缓动；曲末游标消失的帧由调用方传 `PaintFrame.systemTop`。
- 主播放器用 alphaTab 自带滚动，始终是完整页面（面板里有提示）。

## 工作台侧栏与设置（`video-studio.tsx` / `studio-storage.ts`）

- **播放器与工作台是两套独立排版状态**：`playerLayout` 驱动播放器 api；`studioLayout` 只喂
  `renderVideoScore`。`applyStudioLayout` 只 setState，**绝不碰**
  `apiRef.current.settings.display`（否则工作台里调排版会把播放器一起改掉）。
- 播放器默认 `页面 + 100%`（`DEFAULT_PLAYER_LAYOUT`），工作台默认 `横向 175%`
  （`DEFAULT_LAYOUT`）；两边 sanitize 各用自己的 default 兜底。播放器的排版下拉只给
  `页面 / 横向`——「页面（单行）」只是工作台取景。
- 谱表（五线谱/六线谱）与小节宽度是**共享**的：前者是谱面内容（还会随曲谱自动探测），
  后者是逐小节数据，不属于排版记忆。
- 侧栏 `.gsp-vs-fieldset` 是 `fieldset`，UA 默认 `min-width: min-content`，不会收缩；
  CSS 已显式 `min-width: 0`。**长句只能用 `.gsp-hint` 段落，或标签后的 `.gsp-help`
  悬停提示**；chip 只放短标签。侧栏标签列 92px + flex，保证徽标不换行。
- 主题（白底/黑底）只改纸面、谱面与文字；游标颜色独立。

## 音频合成与导出（`offline-export.ts`）

- 无内嵌音频时工作台照常可用（不要求 `playerReady`；`openStudio` 会先
  `loadMidiForScore()`）。时长取 `scoreTimelineMs`（按 master bar 的 tempo automation 积分），
  预览用 `api.play()` 实时合成（强制 1.0×、无节拍器/预备拍/循环）。
- 导出无音轨时先用 `synthesizeScoreAudio()`（`exportAudio` + `useSyncPoints:false`）渲染
  16-bit WAV，再以恒等 syncPoints 交给 `renderOfflineVideo`；失败回退无声并提示。
- `exportAudio` 的 worker 用 `importScripts`，`core.scriptFile` **必须是 classic 构建**
  `assets/alphaTab.worker.js`；指到 ESM 的 `alphaTab.mjs` 会让 `initialize()` 永久挂起。
- `settings.player.bufferTimeInMilliseconds` 必须 ≥ 350 ms（用 500）。alphaTab 的
  ScriptProcessor 每次回调消费 4096 帧，但只维持“半个缓冲区”在途；配 200 ms 时每次回调
  半数空帧 → **恒定 0.5× + 爆音**，`api.timePosition` 也只走一半。播放器与工作台同受影响，
  内嵌伴奏（`<audio>` / backing track）不受影响。
- 编码走 WebCodecs（`VideoEncoder` / `AudioEncoder` + Mediabunny），codec 用完整字符串
  （`vp09.00.10.08` / `avc1.*` / `opus` / `mp4a.40.2`）。导出对话框会逐个探测可用性并回退；
  `AudioEncoder` 缺失时自动导出无声。

## 其它

- i18n：`core/i18n.ts` 中英两份 key 必须一一对应，改完自查。
- 样式：组件 CSS 自带注入；新增主题变量时同步补 `src/app.css` 里的 `--dsw-alias-*` 兜底。
