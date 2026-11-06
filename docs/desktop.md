# 桌面打包（Electron / Tauri）

现状：只发网页版（GitHub Pages）。下面是把 `dist/` 包成桌面 App 的评估结论，需要时再动手。

## 结论

| | Electron | Tauri 2 |
|---|---|---|
| Windows 安装包 | ~95–115 MB | ~8–12 MB |
| 安装后占用 | ~350–420 MB | ~25–35 MB |
| 三平台一致性 | 高（自带 Chromium） | 取决于系统 WebView |
| Windows | ✅ | ✅（WebView2 = Chromium） |
| macOS | ✅ | ✅ 但一般只能 H.264/MP4；`AudioEncoder` 要 Safari 26+ |
| Linux | ✅ | ⚠️ WebKitGTK 的 WebCodecs / GStreamer 插件不确定，导出大概率不可用 |

Electron 的体积几乎全是 Chromium（v45 runtime zip 就 ~120–160 MB），与项目代码无关；
删 locales / 许可文件只能再省 15–20 MB。

## 共同改造点

- **不要用 `file://`**：`fetch`、Worker 都会被拦。注册自定义协议：

  ```js
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
  // app.whenReady 之后
  protocol.handle('app', (req) =>
    net.fetch(pathToFileURL(join(distDir, new URL(req.url).pathname)).toString()));
  win.loadURL('app://gp/index.html'); // secure:true 保证 isSecureContext → WebCodecs 可用
  ```

- **保存**：Electron 里 `<a download>` 原生可用（可加 `will-download` 设另存为）；
  Tauri 里是 no-op，必须换成 `tauri-plugin-fs` + `tauri-plugin-dialog`。
- **拖放**：Electron 原生支持；Tauri 要关 `dragDropEnabled` 才能收到 HTML5 `drop`。
- **Tauri 的 worker 协议坑**：alphaTab 用 blob worker + `importScripts(scriptFile)`，
  自定义协议下可能被拒。绕法：启动时把脚本 `fetch` 成 Blob URL 再交给 `configureAssets`。

## 若真要做

1. 先只做 Windows，跑通「导入 → 预览 → 导出 → 另存为」，量出真实包体。
2. macOS 若要发：锁 MP4/H.264，接受旧系统无音轨；需签名 + 公证。
3. Linux 建议直接上 Electron，别在 WebKitGTK 上耗。
