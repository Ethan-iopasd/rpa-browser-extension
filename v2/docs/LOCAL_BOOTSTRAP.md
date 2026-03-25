# 本地启动指南

最后更新：2026-02-21

## 1. 工作区初始化

1. `cd v2`
2. `pnpm install`

## 2. Python 环境初始化（共享）

1. `cd v2`
2. `uv python install 3.10`
3. `uv venv --python 3.10 .venv`
4. `.\.venv\Scripts\Activate.ps1`
5. `uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"`
6. 若 `.venv` 被锁定，可改为：`uv venv --python 3.10 .venv310`

## 3. API 启动

1. `cd v2/services/api`
2. `uvicorn app.main:app --reload --port 8000`

## 4. 设计器启动

1. 在新终端中执行：`cd v2`
2. `pnpm --filter @rpa/designer dev`

## 5. Agent 启动

1. `cd v2/apps/agent`
2. `rpa-agent --flow ..\..\packages\flow-schema\examples\minimal.flow.json`

## 6. 录制扩展初始化

1. 打开 `chrome://extensions/`
2. 开启开发者模式
3. 加载已解压扩展 `v2/apps/recorder-extension`

## 7. 质量命令

1. `cd v2`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`

## 8. 阶段 F/G/H 新增接口快速验证

1. 任务列表：`GET /api/v1/tasks`
2. 运行统计：`GET /api/v1/runs/stats`
3. 告警列表：`GET /api/v1/runs/alerts`
4. 凭据列表：`GET /api/v1/security/credentials`
5. 审计日志：`GET /api/v1/security/audit`


