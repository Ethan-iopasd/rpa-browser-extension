# Desktop 开发与测试手册（本地）

本文记录桌面端联调与页面拾取相关的本地测试方式，默认在仓库根目录 `v2` 执行命令。

## 1. 前置准备

1. 安装依赖

```powershell
pnpm install
```

2. 建议环境
- Node.js 20+
- pnpm 10+
- Rust 工具链（含 cargo）

## 2. 启动方式

### 方式 A：一条命令联动启动（推荐）

```powershell
pnpm --filter @rpa/desktop dev:tauri
```

说明：
- 会自动拉起 Designer 前端（`127.0.0.1:5173`）和 Tauri 桌面壳。
- 这是日常联调推荐方式。

### 方式 B：双终端分开启动（排障用）

终端 1（在 `v2` 目录）：

```powershell
pnpm --filter @rpa/designer dev --host 127.0.0.1 --port 5173 --mode desktop
```

终端 2（在 `v2/apps/desktop/src-tauri` 目录）：

```powershell
cargo run --no-default-features
```

说明：
- 当你要区分“前端问题”还是“Tauri/Rust 问题”时，用此方式更容易定位。

## 3. 页面拾取回归测试清单

1. 打开任意已有流程，确认画布左上显示节点/连线计数（如 `12 节点 / 11 连线`）。
2. 默认进入流程时：
- 不自动弹出节点配置抽屉。
- 画布视角比之前更近（默认放大一档）。
3. 点击某个节点后，右侧节点配置抽屉正常打开。
4. 在节点配置里发起“页面拾取”，在浏览器页面选中元素后按 `Enter` 或确认按钮。
5. 确认选择器已回填到当前节点配置（`selector`、`selectorType` 等字段有值）。
6. 对 iframe 场景再测一轮，确认能回填并可运行。

## 4. 常见问题与处理

### 4.1 `webview.internal_toggle_devtools not allowed`

现象：
- 控制台出现：
  `webview.internal_toggle_devtools not allowed`

结论：
- 这是 Tauri 权限提示，通常不是画布/拾取失败根因，可先忽略。

### 4.2 `favicon.ico 404`

结论：
- 前端静态资源提示，不影响核心联调。

### 4.3 `cargo run` 报 `PermissionDenied (拒绝访问)`

常见原因：
- 旧的桌面进程或 sidecar 还在占用文件。

处理步骤：
1. 先关闭正在运行的 `rpa_flow_desktop.exe`。
2. 结束残留进程后重新执行 `cargo run --no-default-features`。

### 4.4 画布看起来是白板

排查顺序：
1. 先看左上节点计数是否大于 0。
2. 点击“重置视图”。
3. 仍异常时，完整重启 `pnpm --filter @rpa/desktop dev:tauri` 再测。

## 5. 是否需要重新打包安装包

本地联调阶段不需要重新打包：
- 不需要重打 `RPA Flow Desktop_0.1.0_x64-setup.exe`。
- 直接使用 `dev:tauri` 或双终端方式即可验证功能。

