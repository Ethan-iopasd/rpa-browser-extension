# RPA Flow V2 Beta 用户手册

最后更新：2026-02-21

## 1. 安装

1. 安装 Node.js 与 pnpm。
2. 安装 Python 3.10（建议使用 uv 管理）。
3. 执行：
   - `cd v2`
   - `pnpm install`
   - `uv python install 3.10`
   - `uv venv --python 3.10 .venv`
   - `.\.venv\Scripts\Activate.ps1`
   - `uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"`

## 2. 启动

1. API：`cd v2/services/api && uvicorn app.main:app --reload --port 8000`
2. Designer：`cd v2 && pnpm --filter @rpa/designer dev`
3. 打开浏览器访问 `http://127.0.0.1:5173`

## 3. 创建并运行流程

1. 在画布中创建流程节点与连线。
2. 点击 `Validate` 执行校验。
3. 点击 `Run` 启动运行。
4. 在 Run Console 查看结构化事件日志。

## 4. 使用任务中心

1. 在 Task Center 输入任务名与调度间隔。
2. 点击“基于当前流程创建定时任务”。
3. 可对任务执行“触发/暂停/恢复/失败重跑/禁用”。
4. 在统计与告警区域观察成功率、失败数量和异常提示。

## 5. 常用接口

1. `GET /api/v1/tasks`
2. `GET /api/v1/runs/stats`
3. `GET /api/v1/runs/alerts`
4. `GET /api/v1/security/audit`

## 6. 选择器类型说明

在节点配置中，`click`、`input`、`waitForVisible` 等节点支持“选择器类型 + 选择器值”组合编辑。

1. `CSS`：默认类型，填写如 `#login-btn`、`.form input[name='email']`。
2. `XPath`：会自动保存为 `xpath=...`，例如 `//button[contains(.,'登录')]`。
3. `Text`：会自动保存为 `text=...`，例如 `text=立即提交`。
4. `Role`：会自动保存为 `role=...`，例如 `role=button[name='提交']`。
5. `Playwright`：原样保存自定义定位表达式。

备选选择器建议至少配置 1 条，用于主选择器失效时容灾回退。系统按顺序尝试主选择器与备选选择器，直到命中或超时。
