# RPA Flow API

## 运行

1. `cd v2`
2. `uv python install 3.10`
3. `uv venv --python 3.10 .venv`
4. `.\.venv\Scripts\Activate.ps1`
5. `uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"`
6. `cd services/api`
7. `uvicorn app.main:app --reload --port 8000`

## 项目结构

- `app/main.py`：应用工厂与中间件装配。
- `app/routers`：HTTP 路由入口层。
- `app/services`：业务逻辑层。
- `app/repositories`：持久化层（本地 JSON 持久化）。
- `app/schemas`：请求/响应契约模型。
- `app/core`：共享配置、错误码与错误辅助模块。

## 接口

- `GET /api/v1/health`
- `POST /api/v1/flows/validate`
- `POST /api/v1/runs`
- `GET /api/v1/runs`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `GET /api/v1/runs/{run_id}/export`
- `GET /api/v1/runs/stats`
- `GET /api/v1/runs/alerts`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks/{task_id}/trigger`
- `POST /api/v1/tasks/{task_id}/retry-last-failed`
- `POST /api/v1/security/credentials`
- `GET /api/v1/security/credentials`
- `GET /api/v1/security/audit`

`POST /api/v1/runs` 支持可选 `runOptions`：

```json
{
  "flow": {"...": "..."},
  "runOptions": {
    "maxSteps": 1000,
    "defaultTimeoutMs": 5000,
    "defaultMaxRetries": 0
  }
}
```

## 阶段 C 行为

- 启动运行前进行 DSL 校验与版本迁移校验。
- 由 Agent 执行状态机驱动运行（非数组顺序遍历）。
- 返回节点级结构化事件，包含尝试次数、错误码与执行耗时。
- 当 Agent 环境安装 Playwright 时，`navigate/click/input/wait/extract` 可进入真实浏览器执行。

可通过 Flow 变量控制浏览器模式：

- `_browserMode`：`auto`（默认）/`real`/`simulate`
- `_browserHeadless`：`true`（默认）/`false`

## 错误契约

所有错误统一返回：

```json
{
  "code": "FLOW_VALIDATION_FAILED",
  "message": "Flow validation failed before run.",
  "details": {},
  "requestId": "req_xxx"
}
```

## 质量命令

1. `python -m compileall app`
2. `uv pip install -e ".\services\api[dev]"`
3. `ruff check app`
4. `mypy app`


