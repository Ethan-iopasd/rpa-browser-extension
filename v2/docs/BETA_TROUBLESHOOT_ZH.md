# RPA Flow V2 Beta 排障手册

最后更新：2026-02-21

## 1. `.venv` 无法覆盖或删除

现象：Windows 提示文件被占用（常见是 `python.exe` 或 `.pyd`）。

处理：

1. 关闭占用该环境的终端或编辑器进程。
2. 重新执行 `uv venv --python 3.10 .venv`。
3. 若短期无法释放锁，临时使用 `uv venv --python 3.10 .venv310`。

## 2. API 提示 `AGENT_RUNTIME_UNAVAILABLE`

处理：

1. 确认已执行：
   - `uv pip install -e ".\\apps\\agent[dev]"`
2. 确认当前 Python 解释器来自工作区虚拟环境。

## 3. 任务不执行

检查项：

1. 任务状态必须是 `active`。
2. 定时任务的 `schedule` 需为 `once/interval`，且参数有效。
3. 查看 `GET /api/v1/health` 的 `taskQueueSize` 是否持续增长。
4. 查询 `GET /api/v1/security/audit` 查看调度执行记录。

## 4. 运行失败定位

1. `GET /api/v1/runs/{run_id}` 查看状态与基础信息。
2. `GET /api/v1/runs/{run_id}/events` 查看错误码（`errorCode`）。
3. 使用 `GET /api/v1/runs/{run_id}/export?format=jsonl` 导出日志给开发支持。

## 5. 凭据问题

1. 新增凭据：`POST /api/v1/security/credentials`
2. 列表查询：`GET /api/v1/security/credentials`
3. 若解密失败，优先检查 `RPA_CREDENTIAL_KEY` 是否变化。
