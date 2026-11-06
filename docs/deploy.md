# 部署（GitHub Pages）

站点由 `.github/workflows/pages.yml` 构建发布：
`npm ci → typecheck → build → 裁剪 → 完整性检查 → upload-pages-artifact → deploy-pages`。

## 关键点

- **触发**：push 到 `main` 或手动 dispatch；`paths-ignore: '**.md'`，所以只改文档的推送
  **不会**跑部署。
- **裁剪**：删 `dist/app.js.map`（~6.7 MB）和 `dist/assets/alphaTab.mjs`、
  `alphaTab.core.mjs`（~2.6 MB，alphaTab 已 bundle 进 app.js，导出 worker 用 classic 的
  `alphaTab.worker.js`）。裁完站点 ~6.1 MB / 13 个文件。
- **完整性检查**会拦：缺 worker / soundfont / 字体 / 官方图标，或单文件 >99 MB。
- **Pages 源**必须是 **GitHub Actions**（不是分支）。免费账户的 Pages **不支持私有仓库**
  （API 会返回 422：`Your current plan does not support GitHub Pages for this repository`），
  所以仓库是 public。
- **缓存**：Pages 发 `cache-control: max-age=600` + ETag，文本资源 gzip。改动最多 10 分钟
  才刷新到新版本，强制刷新可立即生效。
- **首屏**：`app.js`（gzip ~786 KB）+ 打开曲谱时取 soundfont（1.32 MB，二进制不压缩）；
  导出时再取 worker（gzip ~312 KB）。
- **不要在公开文档里写死站点地址**（`<owner>.github.io/<repo>/` 可被推导，但不主动宣传）。
  仓库 homepage 字段已清空。
