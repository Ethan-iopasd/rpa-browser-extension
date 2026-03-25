# RPA Flow V2 工作区

该目录用于新的 V2 重构线，与当前扩展代码隔离，确保在不影响现有运行时的前提下持续开发。

## 目录结构

- `apps/designer`：基于 React 的流程设计器 UI。
- `apps/agent`：Python 执行代理，包含分层运行时骨架。
- `apps/recorder-extension`：浏览器录制扩展。
- `services/api`：FastAPI 本地控制面，采用 routers/services/repositories 分层。
- `packages/flow-schema`：共享 DSL Schema 与示例。
- `docs`：PRD 与架构文档。
- `tests`：按阶段契约组织的 Python 基线测试。
- `scripts`：工作区工具脚本。

关键文档：

- `docs/DEVELOPMENT_PLAN_V2.md`
- `docs/STAGE_B_PLAN.md`
- `docs/STAGE_B_CHECKLIST.md`
- `docs/LOCAL_BOOTSTRAP.md`
- `docs/STAGE_F_REPORT.md`
- `docs/STAGE_G_REPORT.md`
- `docs/STAGE_H_REPORT.md`
- `docs/BETA_USER_GUIDE_ZH.md`
- `docs/BETA_TROUBLESHOOT_ZH.md`
- `docs/UI_REFACTOR_PLAN_DIFY.md`
- `docs/UI_REFACTOR_EXEC_REPORT.md`
- `docs/P0_P5_IMPLEMENTATION_REPORT.md`
- `docs/KATALON_INTEGRATION_STAGE1_ZH.md`
- `docs/KATALON_INTEGRATION_STAGE2_ZH.md`
- `docs/KATALON_INTEGRATION_STAGE3_ZH.md`
- `docs/KATALON_INTEGRATION_STAGE4_ZH.md`
- `docs/PRODUCT_FIRST_PRINCIPLE_ZH.md`
- `docs/IFRAME_PICKER_OPEN_SOURCE_BENCHMARK_ZH.md`
- `docs/NATIVE_DESKTOP_PICKER_STAGE0_ZH.md`
- `docs/NATIVE_DESKTOP_PICKER_IMPLEMENTATION_ZH.md`
- `docs/NATIVE_PICKER_STAGE3_REGRESSION_PLAN_ZH.md`
- `docs/DESKTOP_SIDECAR_PACKAGING_ZH.md`

## 快速开始

1. 安装工作区 Node 依赖：
   - `cd v2`
   - `pnpm install`
2. 初始化 Python（`api` 与 `agent` 共用一个虚拟环境）：
   - `cd v2`
   - `uv python install 3.10`
   - `uv venv --python 3.10 .venv`
   - `.\.venv\Scripts\Activate.ps1`
   - `uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"`
   - `python -m playwright install chromium`
   - 如果 `.venv` 被占用无法覆盖，可临时使用：`uv venv --python 3.10 .venv310`
3. 启动 API 服务：
   - `cd v2/services/api`
   - `uvicorn app.main:app --reload --port 8000`
4. 启动设计器：
   - `cd v2`
   - `pnpm --filter @rpa/designer dev`
5. 从 Schema 生成 DSL 类型：
   - `cd v2/packages/flow-schema`
   - `pnpm run generate`
6. 运行 Agent 冒烟：
   - `cd v2/apps/agent`
   - `rpa-agent --flow ..\..\packages\flow-schema\examples\minimal.flow.json`
7. 加载录制扩展：
   - 打开 `chrome://extensions/`
   - 开启开发者模式
   - 加载已解压扩展：`v2/apps/recorder-extension`
8. 录制并回填到 Designer：
   - 在目标网页录制操作
    - 在扩展 Popup 点击 `Send to Designer`
    - 在 Designer 的“录制导入”面板解析并应用

## 桌面原生页面拾取器（无插件）

当前桌面版支持原生拾取（不依赖浏览器扩展）：

1. 在桌面版 Designer 选择节点，点击“页面拾取器”。
2. 输入 `http/https` 页面 URL 后，系统会弹出 Chromium 窗口。
3. 在页面中点击目标元素，选择器会自动回填到当前节点。
4. 按 `Esc` 取消拾取。

实现要点：

1. API 新增 `/api/v1/picker/sessions` 会话接口（创建/查询/取消）。
2. Agent 使用 Playwright 注入拾取脚本，返回 `PickerResult`（含 `framePath/frameLocatorChain`）。
3. Designer 在桌面模式下轮询拾取会话并自动更新节点选择器。

## 前端页面导航（重构后）

1. `/dashboard`：总览
2. `/flows`：流程列表
3. `/flows/:flowId/editor`：流程编辑
4. `/runs`：运行中心
5. `/tasks`：任务中心
6. `/security/credentials`：凭据与审计
7. `/settings`：本地设置

## 条件节点连线规则（Designer）

适用于 `if` / `loop` / `switchCase`：

1. 条件节点右侧提供多个分支端口，请从端口拖线，不使用节点右上角 `+` 快捷接下游。
2. 分支条件会自动写入 `edge.condition`，无需手填。
   - `if-true -> true`
   - `if-false -> false`
   - `loop-body -> body`
   - `loop-exit -> exit`
   - `switch-case-{index} -> cases[index]`
3. 同一分支条件只能连接一次（防止重复分支）。
4. 非分支节点仍禁止重复的 `source -> target` 连线；分支节点允许不同分支条件连到同一个目标节点。
5. 线条中间会显示分支条件标签，便于快速核对流程分支。

`switchCase` 补充：

1. 在右侧属性面板通过 `Cases` 配置分支（逗号或换行分隔）。
2. 系统会自动规范化：去重（忽略大小写）、补上 `default`、最多保留 8 项。
3. 当 `Cases` 被修改时，已失效或重复的旧分支连线会自动清理，避免“看得见但跑不通”的脏连线。

`if` 条件补充（推荐）：

1. 兼容两种写法：
   - 旧写法（legacy）：`expression`，例如 `{{isLoginOk}}`
   - 结构化写法（structured）：`left + operator + right`
2. `operator` 支持：
   - `truthy/falsy`
   - `exists/empty`
   - `eq/ne/gt/gte/lt/lte`
   - `contains/in/regex`
3. 建议先在上游把原始数据归一，再给 `if` 使用，避免直接对脏字符串做判断。
4. Designer 中选中 `if` 节点后，面板会展示“变量来源分析”：
   - 是否存在全局默认值
   - 是否存在上游节点覆盖写入（按图结构静态分析）
   - 运行入参可覆盖提示

`setVariable` 归一化补充：

1. 新增可选 `normalizeAs`：
   - `none/boolean/number/string/trim/lower/upper`
2. 当 `normalizeAs=boolean` 时，可配置：
   - `trueValues`（逗号分隔）
   - `falseValues`（逗号分隔）
   - `defaultBoolean`（兜底）
3. 推荐模式：
   - 上游产出 `status/raw`
   - `setVariable(normalizeAs=boolean)` 产出 `isXxx`
   - `if` 只判断 `{{isXxx}}`

## 质量门禁

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm verify`

## 桌面版打包、发布与更新（Stage 3）

### 1) 打包

构建机前置：

1. 安装 Python 3.10（用于 sidecar 构建）
2. 安装 `uv`（推荐）

标准打包（含检查）：

```powershell
cd v2
pnpm release:desktop
```

仅构建 Python sidecar（构建机执行，客户端不需要 Python）：

```powershell
cd v2
pnpm release:desktop:sidecar
```

如果你当前就在 `uv` 管理的虚拟环境中，建议显式指定解释器：

```powershell
cd v2
powershell -ExecutionPolicy Bypass -File .\scripts\release\build_api_sidecar.ps1 -PythonExecutable "$env:VIRTUAL_ENV\Scripts\python.exe"
```

提示：启用 `externalBin` 后，`cargo check` 需要 sidecar 文件存在；首次请先执行 `pnpm release:desktop:sidecar`。

快速打包（跳过检查）：

```powershell
cd v2
pnpm release:desktop:fast
```

仅重生发布清单（不重新编译）：

```powershell
cd v2
pnpm release:desktop:manifest
```

### 2) 产物位置

1. 安装包目录：`dist\desktop\<version>\bundle`
2. 清单文件：`dist\desktop\<version>\desktop-release-manifest.json`
3. Windows 安装包（NSIS）：`dist\desktop\<version>\bundle\nsis\RPA Flow Desktop_<version>_x64-setup.exe`
4. Sidecar 输出目录（构建机）：`apps\desktop\src-tauri\bin\rpa-api-sidecar-<target-triple>.exe`

### 3) 发布建议流程

1. 先执行质量门禁：
   - `pnpm --filter @rpa/designer typecheck`
   - `pnpm --filter @rpa/desktop typecheck`
   - `python scripts/python_syntax_check.py`
   - `cargo check`（在 `apps/desktop/src-tauri`）
2. 执行 `pnpm release:desktop`
3. 校验 `desktop-release-manifest.json` 中 `artifacts[].sha256`
4. 在干净机器执行安装并跑冒烟：
   - 启动后可打开 `/dashboard`
   - 设置页可查看“桌面运行诊断”
   - 可执行“重启桌面服务”和“导出诊断包”

### 3.1 打包原则（不污染客户机环境）

1. 客户机不依赖系统 Python，不修改系统 PATH。
2. API/Agent 通过内置 sidecar 启动（`externalBin`）。
3. Playwright Chromium 使用应用私有目录（`PLAYWRIGHT_BROWSERS_PATH`）。
4. `uv` 仅用于构建机依赖安装与 sidecar 产物生成。
5. 桌面端默认优先使用本地端口 `18080`（避免与开发期 `8000` 冲突），可通过环境变量 `RPA_DESKTOP_API_PORT` 指定优先端口；若被占用会自动避让到可用端口。

### 3.2 常见问题排查（sidecar 构建）

1. `uv cache` 权限报错（WinError 5 / permission denied）：
   - 使用项目本地缓存目录后重试：
   - `set UV_CACHE_DIR=%CD%\\.uv-cache`（PowerShell 可用 `$env:UV_CACHE_DIR="$PWD\\.uv-cache"`）
2. 构建机存在多个 Python，脚本选错解释器：
   - 使用 `-PythonExecutable "<path-to-python.exe>"` 显式指定。
   - 若 `uv` 缓存权限持续异常，可先设置项目级缓存：`$env:UV_CACHE_DIR="$PWD\\.uv-cache"`。
   - 构建脚本已支持在 `pip` 不可用时自动回退到 `uv pip --python <env>`。
   - 若本机已有可用虚拟环境（例如 `.venv310`），可加 `-UseCurrentPythonEnv` 直接在该环境构建 sidecar。
3. `cargo check` 报缺少 sidecar 文件：
   - 先执行 `pnpm release:desktop:sidecar`，再执行 `cargo check` 或 `pnpm release:desktop`。
4. 原生拾取无法启动浏览器：
   - 在构建机执行 `python -m playwright install chromium`，或重新跑 `pnpm release:desktop:sidecar`（默认会安装 Chromium）。
5. sidecar 复制失败（`being used by another process`）：
   - 关闭正在运行的 RPA Flow Desktop / sidecar 进程后重试构建。

### 3.3 原生 Picker 选择器策略（可配置）

1. 桌面原生 picker 使用配置化规则生成 iframe 候选（优先 `src host+path`，动态 `id/name` 降权）。
2. 可通过环境变量覆盖默认策略（构建机或启动 sidecar 时注入）：
   - `RPA_PICKER_SELECTOR_POLICY_PATH=<json-file-path>`
   - `RPA_PICKER_SELECTOR_POLICY_JSON=<inline-json>`
3. 默认策略定义位置：`apps/agent/agent/runtime/picker_policy.py`。
4. 覆盖示例（inline）：
   - `{"frame":{"stableQueryAllowlist":["product","lang"],"selectorPriority":["src_base","nth_of_type","name_stable","id_stable"]}}`
5. `attributeFilters` 支持“首条命中即生效（first-match-wins）”，可像 Cypress 一样做 include/exclude：
   - `{"frame":{"attributeFilters":[{"attribute":"^(id|name)$","value":"(auto-id|x-urs-iframe|\\d{6,})","include":false}]}}`
   - 建议把排除规则放前面，避免随机 id/name 变成主候选。

### 4) 更新策略（当前）

1. 当前采用“重新安装新版安装包”方式更新。
2. 更新后在设置页检查桌面版本是否符合预期。
3. 若新版本异常，使用上一个稳定安装包回滚。
4. 诊断排障时优先导出诊断包（设置页 -> 导出诊断包）。

### 5) 相关文档

1. 发布脚本说明：`scripts/release/README.md`
2. 桌面发布检查清单：`docs/DESKTOP_RELEASE_CHECKLIST_ZH.md`

## 第 1 周目标

交付最小链路：

- 设计器可保存流程 JSON。
- API 可校验并启动一次运行。
- Agent 契约已定义并有桩实现。
- 可查询运行日志。


