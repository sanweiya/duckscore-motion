# Duck Score Motion（独立网页版）

Guitar Pro / MusicXML 乐谱播放器 + 动态曲谱视频工作台。这是一个**自包含**目录：不依赖任何上级仓库。

## 运行

```bash
npm install
npm start          # 构建 + 起本地服务，默认 http://127.0.0.1:4173/
PORT=5173 npm start
npm run desktop    # 桌面版窗口（Electron，同一份 dist/）
npm run desktop:build  # 打包桌面安装器（Linux: deb）
```

用 Chrome / Edge 打开输出的地址。**必须通过 http 访问**，不要双击 `index.html`
（alphaTab 运行时要 fetch worker 脚本、字体与音色库，`file://` 会被拦，表现为谱面空白或无声）。

## 目录

```
index.html
src/main.ts        外壳：绑定 React / 语言包 / 资源路径，挂载 Player
src/app.css        全窗口布局 + 主题变量兜底
core/              全部业务代码（播放器、工作台、谱面渲染、导出、i18n、样式）
vendor/            alphaTab worker/core、SMuFL 字体、Sonivox 音色库、官方徽标
scripts/build.mjs  esbuild 打包 + 复制 vendor → dist/
scripts/serve.mjs  零依赖静态服务器
desktop/main.cjs   Electron 壳：本地 http 宿主 dist/，网页版与桌面版共用产物
electron-builder.yml  桌面打包配置（Linux 实测；Windows/macOS 走 CI 补）
```

更多说明见 `AGENTS.md`（业务代码约束在 `core/AGENTS.md`，打包/部署见 `docs/`）。
