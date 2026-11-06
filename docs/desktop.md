# 桌面版（Electron）

桌面外壳已落地，与网页版**长期并行**：同一份代码、同一份 `dist/`，两个发布目标，
不维护两套业务代码。本机是 Linux（deb13, x64），已实测；Windows/macOS 以后用 CI 补。上线版本历史评估见文末。

## 心智模型

| | 网页版 | 桌面版 |
|---|---|---|
| 载体 | GitHub Pages 静态站 | Electron（自带 Chromium 156） |
| 产物 | `dist/` | `dist/` + `desktop/main.cjs` 打进 asar |
| 构建 | `npm run build` | **同一个** `dist/`，`npm run desktop:build` 只加壳 |
| 业务代码 | `core/`、`src/` | 完全一样，桌面壳不做任何 UI 改动 |
| 设置记忆 | 浏览器的 localStorage（三件套 key 不变） | Electron `userData` 里的 localStorage，**天然与浏览器隔离** |
| 保存导出 | `<a download>` 直接落浏览器下载 | 原生「另存为」对话框（`will-download` 接管） |
| 渲染能力 | 取决于浏览器 | WebCodecs（VP9/H.264/Opus）全可用 |

桌面壳与网页版的硬约束：**桌面壳只当宿主**，不许在壳里塞业务逻辑；视觉与行为的
改动一律进 `core/`，保证两个目标同时受益。

## 命令

```bash
npm run desktop:run    # 未改代码时：直接用现有 dist/ 启动 Electron 窗口
npm run desktop        # 重新构建 dist/ + 启动（日常调试桌面版）
npm run desktop:build  # 构建 dist/ + 打包 Linux 安装器到 release/
```

产物（v0.1.0, x64）：`release/Duck Score Motion-0.1.0.AppImage`（134 MB）、
`duckscore-motion_0.1.0_amd64.deb`（107 MB）。体积几乎全是 Chromium，与项目代码无关。

## 壳的实现（`desktop/main.cjs`，CommonJS，不用 preload/IPC）

- **http origin 而不是 `file://`，也不是自定义协议**：启动时把 `dist/` 提供
  的静态服务挂在 `127.0.0.1` 的**临时端口**上（和 `npm run serve` 不会撞端口）。
  `http://127.0.0.1` 即 secure context → WebCodecs / Worker / 音色库 fetch
  与网页版行为一致；也避开 Tauri 那类「自定义协议下 blob worker `importScripts` 被拒」的坑。
  静态处理逻辑与 CLI 共用 `scripts/static-server.cjs`，勿复制两份。
- **窗口即浏览器**：`contextIsolation / sandbox: true`、`nodeIntegration: false`，
  渲染层自足；外部 http(s) 链接交给系统浏览器，不弹新窗口。
- **导出保存**：`session.on('will-download')` → 原生另存为对话框，取消则丢弃。
- **数据**：无任何 userData 写入代码，localStorage 三件套自动落在
  `~/.config/Duck Score Motion/`。key 沿用网页版，**改名仍会丢桌面用户设置**。
- 单实例锁；生产窗口无菜单栏，开发模式 F12/Ctrl+Shift+I 开 DevTools。
- 窗口图标取 `dist/brand/icon-512.png`；打包由 `electron-builder.yml`
  负责（AppImage + deb，`syncDesktopName` 保证任务栏图标关联）。

## 大陆构建环境备忘

Electron 二进制与 electron-builder 工具链默认从 GitHub 下载，直连失败时用镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run desktop:build
```

首次安装后需要重跑 `npm rebuild electron`（或 `node node_modules/electron/install.js`）
才会真正下载二进制；electron-builder 会跳过 `files` 之外的 node_modules，
本项目壳零运行时依赖，包里只有 Electron 自身 + `dist/`。

## 以后要做的（按需）

- **Windows/macOS**：加 GitHub Actions job 交叉打包（`.AppImage/.deb/.exe/.dmg`）；
  macOS 需要 Apple 开发者账号做签名与公证，否则用户要手动放行 Gatekeeper。
- 自动更新（electron-updater）：等有真实用户再说，最新版检测文件 `latest-linux.yml` 已随产物生成。
- Tauri 想再试的话：体积 8–12 MB 很诱人，但 macOS 无 VP9 编码、Linux WebKitGTK
  不保证 WebCodecs，导出功能基本翻车，见下表。

<details>
<summary>历史评估（2026-11，动手前结论，仍有效）</summary>

| | Electron（已采用） | Tauri 2 |
|---|---|---|
| Windows 安装包 | ~95–115 MB | ~8–12 MB |
| 安装后占用 | ~350–420 MB | ~25–35 MB |
| 三平台一致性 | 高（自带 Chromium） | 取决于系统 WebView |
| Windows | ✅ | ✅（WebView2 = Chromium） |
| macOS | ✅ | ✅ 但一般只能 H.264/MP4；`AudioEncoder` 要 Safari 26+ |
| Linux | ✅（已验证） | ⚠️ WebKitGTK 的 WebCodecs / GStreamer 插件不确定，导出大概率不可用 |

常见陷阱与本项目对策：

- `file://` 会拦 fetch/Worker（alphaTab worker 脚本、音色库都跑不了）→ 已用本地 http origin。
- `blob:` + `importScripts` 的 classic worker 在自定义协议下可能被拒 → 本地 http 无此问题。
- `<a download>` 在 Tauri 是 no-op，要换成 tauri-plugin-fs/dialog → Electron 原生可用并接管了另存为。
- HTML5 拖放 Tauri 要关 `dragDropEnabled` → Electron 原生支持。
- Electron 里删 locales / 许可文件只能省 15–20 MB，收益太小，不做。

</details>
