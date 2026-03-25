# 原生页面拾取器 Stage 3 回归计划（桌面端）

更新时间：2026-02-24

## 目标

1. 验证“页面可打开但无法拾取/顶部栏不显示”问题已修复。
2. 验证不同页面类型下，拾取结果可稳定回填到 Designer。
3. 验证失败路径可观测（`picker_sessions.json` 有明确 diagnostics）。

## 回归范围

1. 桌面端原生拾取入口（NodePanel -> 页面拾取器）。
2. API picker 会话管理（创建、轮询、取消）。
3. Agent Playwright 注入与事件回传链路。
4. 端口动态配置与自动避让后的请求链路。

## 用例清单

### A. 基础可用性

1. 打开任意 `http/https` 页面后，顶部栏可见。
2. 鼠标悬停元素，能看到高亮框与状态文本变化。
3. 点击元素后，拾取会话状态变为 `succeeded`，节点 selector 被回填。
4. 按 `Esc` 或点“取消”，会话状态为 `cancelled` 且有取消原因。

### B. 典型复杂页面

1. 登录页（动态脚本较多）可拾取输入框和按钮。
2. iframe 页面可拾取并带回 `framePath/frameLocatorChain`。
3. 高交互页面（大量事件拦截）可正常捕获点击。
4. 页面刷新后重新注入，顶部栏仍可恢复。

### C. 异常路径

1. 拾取中手动关闭浏览器窗口，会话应为 `cancelled` 或 `failed`（含原因）。
2. 超时未选择元素，会话应为 `failed` 且 `errorCode=PICKER_TIMEOUT`。
3. 注入异常时，会话 `diagnostics` 含注入错误样本（`installSampleErrors`）。

### D. 端口与运行环境

1. 默认端口可用时，桌面 API 使用默认端口启动。
2. 默认端口被占用时，桌面自动切换到可用端口且前端请求正常。
3. 配置 `RPA_DESKTOP_API_PORT` 后，优先使用指定端口。

## 执行步骤（建议）

1. 先执行质量门禁：
   - `pnpm --filter @rpa/designer typecheck`
   - `pnpm --filter @rpa/desktop typecheck`
   - `python scripts/python_syntax_check.py`
   - `cargo check`（`apps/desktop/src-tauri`）
2. 构建 sidecar：
   - `pnpm release:desktop:sidecar`
   - 如构建机 `uv` 权限异常，使用：
   - `powershell -ExecutionPolicy Bypass -File .\scripts\release\build_api_sidecar.ps1 -SkipUv -UseCurrentPythonEnv -PythonExecutable "<python.exe>"`
3. 构建并安装桌面包：
   - `pnpm release:desktop`
4. 按用例清单执行回归并记录结果。

## 诊断采集

1. 会话日志：`%APPDATA%\\com.rpaflow.desktop\\.runtime\\picker_sessions.json`
2. 诊断包：设置页 -> 导出诊断包
3. 关键字段：
   - `errorCode` / `errorMessage`
   - `diagnostics.installTotals`
   - `diagnostics.installSampleErrors`
   - `diagnostics.submitEvents` / `diagnostics.cancelEvents`
