# Duck Score Motion（独立网页版）— 交接说明

纯前端应用：React + alphaTab 的曲谱播放器与动态曲谱视频工作台。产物 `dist/` 是静态目录，
浏览器直接跑，也可打包成桌面 App。自包含，不依赖上级仓库。

## 运行

```bash
npm install
npm start        # 构建 + 起服务 → http://127.0.0.1:4173/
npm run build    # 只构建到 dist/
npm run serve    # 只起服务（需先 build）
npm run typecheck
npm run desktop  # 构建 dist/ + Electron 窗口（桌面版调试）
npm run desktop:build  # 桌面安装器（Linux: AppImage/deb → release/）
```

必须走 http(s)，不能 `file://`（worker / fetch 会被拦）。导出依赖 WebCodecs → Chrome / Edge。

## 协作约定

- **远端写操作逐项确认，不许推断**：`git push`（哪怕 1 个提交）、remote 配置、建仓、PR、
  tag/release、仓库设置（visibility/homepage/topics/Pages/secrets）、任何触发部署的操作，
  都要先问并得到「推送 / 发布 / 上线」这类明确答复。
  反例：用户说「修一下图标」「别在 README 写网址」≠「可以再推一次」。
- **用户可能攒批推送**：默认只本地提交，收尾报告「待推送 N 个提交 + 会触发几次部署」。
- 本地动作（改代码、typecheck、build、本地提交、起服务、跑测试）不需要逐次确认。

## 结构

| 路径 | 作用 |
|---|---|
| `core/` | 全部业务代码；**改之前先读 `core/AGENTS.md`** |
| `src/main.ts` | 外壳：React 绑定 / 语言 / 资源路径（唯一与宿主相关） |
| `desktop/` | Electron 壳，只当宿主不塞业务；网页版与桌面版共用 `dist/`，见 `docs/desktop.md` |
| `brand/` | 图标与 logo（构建时拷到 `dist/brand/`），规格见 `brand/README.md` |
| `scripts/` | `build.mjs`（esbuild + 拷资源）、`serve.mjs`（静态服务）、`static-server.cjs`（CLI 与桌面壳共用的处理逻辑） |
| `docs/` | 打包、部署等长文档 |
| `.github/workflows/pages.yml` | GitHub Pages 构建与部署 |

## 全局不变式

- 预览与离线导出共用 `layoutVideoCanvas` / `paintVideoFrame`：视觉改动必须两边一致，
  只允许分辨率/帧率不同。
- alphaTab 的「♪ alphaTab.net」谱面署名必须保留可见（不删、不遮、不裁、不改渲染结果）；
  表头「Powered by alphaTab」是补充署名。
- localStorage 三件套：`gp-score-player.layout.v1` / `.studio.v1` / `.export.v1`。
  **改 key 会丢用户设置**，要改就得写迁移。
- 站点名只有一处：`index.html` 的 `<title>` + `<meta name="description">`。
- 默认只做本地提交；推送 / 发布 / 改仓库设置都要逐项确认（见上）。

## 深入阅读

| 主题 | 文档 |
|---|---|
| 谱面渲染、排版、相机、游标 | `core/AGENTS.md` |
| 工作台侧栏、设置解耦、i18n、主题 | `core/AGENTS.md` |
| 音频合成、WebCodecs 导出 | `core/AGENTS.md` |
| Electron 桌面版：壳实现、打包、大陆镜像 | `docs/desktop.md` |
| GitHub Pages 部署与缓存 | `docs/deploy.md` |
| 图标 / logo 规格 | `brand/README.md` |
