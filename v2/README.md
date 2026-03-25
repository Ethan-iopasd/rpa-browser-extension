# RPA Flow V2 工作区

`v2` 是当前主开发目录，包含设计器、执行代理、本地 API、桌面端和录制扩展。

## 目录结构

- `apps/designer`：基于 React 的流程设计器 UI
- `apps/agent`：Python 执行代理
- `apps/recorder-extension`：浏览器录制扩展
- `apps/desktop`：Tauri 桌面端
- `services/api`：FastAPI 本地控制面
- `packages/flow-schema`：共享 DSL Schema 与生成类型
- `tests`：Python 基线与契约测试
- `scripts`：构建、发布和工具脚本

## 本地启动

### 1. 安装依赖

```powershell
cd v2
pnpm install

uv python install 3.10
uv venv --python 3.10 .venv
.\.venv\Scripts\Activate.ps1
uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"
python -m playwright install chromium
```

如果 `.venv` 被占用无法覆盖，可临时使用：

```powershell
uv venv --python 3.10 .venv310
```

### 2. 启动 API

```powershell
cd v2\services\api
uvicorn app.main:app --reload --port 8000
```

### 3. 启动 Designer

```powershell
cd v2
pnpm --filter @rpa/designer dev
```

### 4. 生成 Schema 类型

```powershell
cd v2\packages\flow-schema
pnpm run generate
```

### 5. 运行 Agent 冒烟

```powershell
cd v2\apps\agent
rpa-agent --flow ..\..\packages\flow-schema\examples\minimal.flow.json
```

### 6. 加载录制扩展

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 加载已解压扩展：`v2/apps/recorder-extension`

### 7. 录制并回填到 Designer

1. 在目标网页录制操作
2. 在扩展弹窗点击 `Send to Designer`
3. 在 Designer 的“录制导入”面板解析并应用

## 桌面原生页面拾取器

桌面版支持原生拾取，不依赖浏览器扩展：

1. 在桌面版 Designer 选择节点，点击“页面拾取器”
2. 输入 `http/https` 页面 URL 后，系统会弹出 Chromium 窗口
3. 在页面中点击目标元素，选择器会自动回填到当前节点
4. 按 `Esc` 取消拾取

实现要点：

1. API 提供 `/api/v1/picker/sessions` 会话接口
2. Agent 使用 Playwright 注入拾取脚本并返回 `PickerResult`
3. Designer 在桌面模式下轮询拾取会话并更新节点选择器

## 常用页面

1. `/dashboard`：总览
2. `/flows`：流程列表
3. `/flows/:flowId/editor`：流程编辑
4. `/runs`：运行中心
5. `/tasks`：任务中心
6. `/security/credentials`：凭据与审计
7. `/settings`：本地设置

## 质量门禁

```powershell
cd v2
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

## 桌面打包

### 标准打包

```powershell
cd v2
pnpm release:desktop:sidecar
pnpm release:desktop
```

### 快速打包

```powershell
cd v2
pnpm release:desktop:fast
```

### 仅刷新发布清单

```powershell
cd v2
pnpm release:desktop:manifest
```

### 产物位置

1. 安装包目录：`dist\desktop\<version>\bundle`
2. 发布清单：`dist\desktop\<version>\desktop-release-manifest.json`
3. Windows 安装包：`dist\desktop\<version>\bundle\nsis\RPA Flow Desktop_<version>_x64-setup.exe`
4. Sidecar 输出目录：`apps\desktop\src-tauri\bin\rpa-api-sidecar-<target-triple>.exe`

### 打包原则

1. 客户机不依赖系统 Python，也不修改系统 PATH
2. API 和 Agent 通过内置 sidecar 启动
3. Playwright Chromium 使用应用私有目录
4. `uv` 只用于构建机依赖安装与 sidecar 产物生成

## 发布流程

### 1. 执行验证

```powershell
cd v2
pnpm verify
```

### 2. 构建桌面产物

```powershell
cd v2
pnpm release:desktop:sidecar
pnpm release:desktop
```

### 3. 检查产物

1. 校验 `desktop-release-manifest.json` 中的 `artifacts[].sha256`
2. 在干净机器安装并做一次冒烟
3. 确认 `/dashboard`、设置页和桌面诊断功能可用

### 4. 创建 Git 标签并推送

```powershell
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "v0.1.0"
git push origin main --tags
```

### 5. 发布 GitHub Release

建议上传：

1. `RPA Flow Desktop_<version>_x64-setup.exe`
2. `desktop-release-manifest.json`

推荐标签格式：

1. 正式版：`vX.Y.Z`
2. 预发布：`vX.Y.Z-beta.N`
