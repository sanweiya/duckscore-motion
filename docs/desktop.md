# 桌面版（Electron）

桌面外壳已落地，与网页版**长期并行**：同一份代码、同一份 `dist/`，两个发布目标，
不维护两套业务代码。Linux（deb13, x64）已实测；Windows/macOS 在同一份配置下
也能由本机构建，见「跨平台构建」。

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
npm run desktop:run     # 未改代码时：直接用现有 dist/ 启动 Electron 窗口
npm run desktop         # 重新构建 dist/ + 启动（日常调试桌面版）
npm run desktop:build   # 构建 dist/ + 打包【当前平台】的安装器到 release/
npm run desktop:build:linux   # Linux deb（x64）
npm run desktop:build:win     # Windows NSIS 安装器
npm run desktop:build:mac     # macOS dmg（当前架构）
```

产物（v0.1.0）：

| 平台 | 文件 | 大小 |
|---|---|---|
| Linux | `release/duckscore-motion_0.1.0_amd64.deb` | ~107 MB |
| Windows | `release/duckscore-motion-0.1.0-setup-x64.exe` | ~100 MB |
| macOS | `release/duckscore-motion-0.1.0-arm64.dmg` | ~110 MB |

Linux 只出 deb——维护者的机器用 deb 安装，AppImage 不用、默认不构建（体积几乎
全是 Chromium，与项目代码无关；要 AppImage 时在 `electron-builder.yml` 的
`linux.target` 里加回）。

## 壳的实现（`desktop/main.cjs`，CommonJS，不用 preload/IPC）

- **http origin 而不是 `file://`，也不是自定义协议**：启动时把 `dist/` 提供
  的静态服务挂在 `127.0.0.1` 的**固定端口 45837**（与 `npm run serve` 的 4173 不撞）。
  localStorage 按来源隔离，端口每次都换会清空设置记忆，因此端口必须稳定；
  被占用时降级为临时端口并打日志（仅该会话不保留设置）。
  Windows 上 45837 可能落在 Hyper-V/WSL 的保留段（`netsh int ipv4 show
  excludedportrange protocol=tcp` 可查），届时同样只影响该会话的设置记忆。
  `http://127.0.0.1` 即 secure context → WebCodecs / Worker / 音色库 fetch
  与网页版行为一致；也避开 Tauri 那类「自定义协议下 blob worker `importScripts` 被拒」的坑。
  静态处理逻辑与 CLI 共用 `scripts/static-server.cjs`，勿复制两份。
- **窗口即浏览器**：`contextIsolation / sandbox: true`、`nodeIntegration: false`，
  渲染层自足；外部 http(s) 链接交给系统浏览器，不弹新窗口。
- **导出保存**：`session.on('will-download')` 里只调 **`item.setSaveDialogOptions()`**
  （标题 + 默认路径），自己**不要弹** `dialog.showSaveDialog`：处理器返回时
  savePath 为空的话，Electron 下载系统会**再弹一个标题=URL 的保存框**，
  我们就会一次导出弹两个框（源码
  `electron_download_manager_delegate.cc` 的 `OnDownloadPathGenerated`）。
  一个框由 Electron 自己弹，取消即取消下载，另存即 `done completed`。
  ⚠️ 已踩过的坑：
  - `will-download` 里 `event.preventDefault()` 是**取消这次下载**，不是“接管另存为”；
    接管须 `item.setSavePath()`，用户取消对话框是 `item.cancel()`。
    先 preventDefault 再弹框表现为“弹了保存窗、点了保存、一个文件都没有”。
  - 自调 `dialog.showSaveDialog` + 处理器空 savePath 返回 = 双弹窗（见上）；
    异步/绝对路径/关 portal 都救不了，必须改用 `setSaveDialogOptions`。
  - 共用的 http server 必须挂 `clientError` / `error` 处理：Chromium 启动时会抢建/弃置
    连接，未处理的 server `error`（ECONNRESET 一类）会让 Node 以
    「未处理 error 事件」**直接崩掉主进程**（窗口闪退/白屏），见 `scripts/static-server.cjs`。
  - 单实例锁：占锁方可能是**没关干净的旧实例**（AppImage 的进程名是挂载点里的
    `duckscore-motion`，注意 pkill/排查时别漏）。占锁失败时壳会打日志并直接退出，
    用户表现为「第二次启动没反应」—— 先把旧实例关掉。
- **平台差异（macOS）**：生产模式保留最小应用菜单（App / Edit / Window）。
  macOS 的 Cmd+Q、Cmd+W、Cmd+C/V 都由菜单 role 提供，菜单被去掉这些快捷键
  会静默失效；关掉最后一个窗口时进程**不退出**（Dock 图标点击走 `activate` 重建窗口），
  内部 http 服务也保持监听，重建时复用同一端口。Windows/Linux 仍是关窗即退出、
  无菜单栏。
- **数据**：无任何 userData 写入代码，localStorage 三件套自动落在
  `~/.config/Duck Score Motion/`（Windows：`%APPDATA%\Duck Score Motion\`，
  macOS：`~/Library/Application Support/Duck Score Motion/`）。key 沿用网页版，
  **改名仍会丢桌面用户设置**。
- 单实例锁；生产窗口无菜单栏，开发模式 F12/Ctrl+Shift+I 开 DevTools。
- 窗口图标取 `dist/brand/icon-512.png`（窗口/任务栏）；安装包图标是
  `build/` 下的另一套（见下节），由 `electron-builder.yml` 引用。

## 跨平台构建

配置是**加法**的：`electron-builder.yml` 里 `linux` / `win` / `mac` 三段并存，
按宿主平台各自出包。**改动某一个平台时不要删掉其它段**——删 `linux` 会直接
破坏维护者当前的分发路径。

### 谁能在哪出什么

| 宿主 | Linux deb | Windows exe | macOS dmg |
|---|---|---|---|
| Linux | ✅ 已实测 | ⚠️ 可以，需 wine | ❌ |
| Windows | ❌（fpm 无 Windows 版） | ✅ | ❌ |
| macOS | ✅（交叉，少用） | ⚠️ 可以，需 wine | ✅ |

`dmg` 依赖 macOS 自带的 `hdiutil`，只能在 macOS 宿主上出。在 Windows 上跑
`npm run desktop:build` 得到的是 exe，不是 deb —— 这是 `electron-builder`
无参数时「构建当前平台」的默认行为。

架构默认跟随宿主（Apple Silicon → arm64，Intel → x64）。要给另一种架构出包，
在命令后加 `-- --x64` 或 `-- --arm64`（会生成第二份安装包）。

### 图标（`build/`）

桌面安装包图标不在 `brand/`（那是网页资源，会被拷进 `dist/`），而在 `build/`：

| 文件 | 用途 |
|---|---|
| `build/icons/16x16.png … 128x128.png` | 小尺寸，来自 `brand/favicon.svg`（无投影、描边加粗、鸭子放大） |
| `build/icons/256x256.png … 1024x1024.png` | 大尺寸，来自 `brand/logo.svg`（完整插画，带投影） |
| `build/icon.ico` | Windows，16/24/32/48/64/128/256 七个尺寸 |
| `build/icon.icns` | macOS，16/32/64/128/256/512/1024（`icp4…ic10`） |

`electron-builder` 对 `.ico` / `.icns` 是**原样使用**、不再转换，所以两个源各管
一段尺寸是有效的。生成方式与换 logo 的重出步骤见 `brand/README.md`。

### 签名与分发

本地构建运行**不需要**签名：自己机器上的产物没有 quarantine 标记，双击即可。

只有**发给别人**才需要：

- **Windows**：未签名的 exe 从网上下载会被 SmartScreen 拦（「仍要运行」可绕过）。
  签名用代码签名证书，设 `WIN_CSC_LINK`（或 `CSC_LINK`）+ `CSC_KEY_PASSWORD` 后
  `electron-builder` 自动签。
- **macOS**：需要 Apple Developer 账号（$99/年）。设 `CSC_LINK` /
  `CSC_KEY_PASSWORD` 签名，再设 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
  `APPLE_TEAM_ID` 让 `electron-builder` 自动公证。未签名的包拷给别人后要
  右键 →「打开」或在「隐私与安全性」里放行一次。

没有账号也能构建、能自用，只是分发给陌生人体验很差。

## 大陆构建环境备忘

Electron 二进制与 electron-builder 工具链默认从 GitHub 下载，直连失败时用镜像。
**两个阶段都要**：

```bash
# 1) npm install 阶段：下载 Electron 二进制
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 2) 打包阶段：下载 electron-builder 的辅助工具（fpm/nsis/winCodeSign 等）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run desktop:build
```

首次安装后需要重跑 `npm rebuild electron`（或 `node node_modules/electron/install.js`）
才会真正下载二进制；electron-builder 会跳过 `files` 之外的 node_modules，
本项目壳零运行时依赖，包里只有 Electron 自身 + `dist/`。

若包管理器是 pnpm 10+，它默认不执行依赖的 install 脚本：要么用 npm
（仓库里有 `package-lock.json`），要么在 `pnpm.onlyBuiltDependencies` 里放行
`electron` / `electron-builder`，否则 `electron .` 会报
`Electron failed to install correctly`。

## 以后要做的（按需）

- **CI 交叉打包**：加 GitHub Actions job 出三平台安装包；签名凭据放 secrets。
  当前是「在哪台机器上构建，就出哪台机器的包」，够用但需要那台机器有工具链。
- 自动更新（electron-updater）：等有真实用户再说，最新版检测文件
  （`latest-linux.yml` 等）已随产物生成。
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
