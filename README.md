# GP Studio（独立网页版）

Guitar Pro 乐谱播放器 + 视频工作台。这是一个**自包含**目录：不依赖任何上级仓库。

## 运行

```bash
npm install
npm start          # 构建 + 起本地服务，默认 http://127.0.0.1:4173/
PORT=5173 npm start
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
```

更多说明见 `AGENTS.md`。
