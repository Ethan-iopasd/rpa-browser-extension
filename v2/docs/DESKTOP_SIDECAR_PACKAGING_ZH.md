# Desktop Sidecar 打包方案（uv + Tauri externalBin）

## 目标

- 客户机不需要安装 Python。
- 不依赖客户机已有 Python/Node 环境。
- 安装包包含 API/Agent sidecar 与 Playwright Chromium。

## 方案

1. 构建机使用 `uv` 创建隔离环境：`.venv-sidecar`。
2. 用 PyInstaller 生成 `rpa-api-sidecar-<target-triple>.exe`（单文件）。
3. `tauri.conf.json` 通过 `bundle.externalBin` 打包 sidecar。
4. Chromium 预下载到 `v2/.playwright-browsers`，通过 `bundle.resources` 打包。
5. 桌面端运行时仅启动 sidecar，并设置：
   - `RPA_RUNTIME_DIR`
   - `PLAYWRIGHT_BROWSERS_PATH`
   - `RPA_API_CORS_ORIGINS`

## 关键脚本

1. sidecar 构建：
   - `scripts/release/build_api_sidecar.ps1`
2. 桌面安装包构建（已接入 sidecar 构建）：
   - `scripts/release/build_desktop_installer.ps1`

## 命令

```powershell
cd v2
pnpm release:desktop:sidecar
pnpm release:desktop
```

## 注意事项

1. 首次构建需下载 Playwright Chromium（可通过 `-SkipPlaywrightInstall` 跳过，前提是已缓存）。
2. `cargo check` 在启用 `externalBin` 后需要 sidecar 文件存在，发布脚本已处理该顺序。
3. 客户机环境不应写入全局变量，仅使用进程级环境变量。

