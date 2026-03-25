# 架构 V1

最后更新：2026-02-21

## 组件

1. `apps/designer`（React + TypeScript）
   - 流程图编辑与运行控制台。
   - 仅与 `services/api` 通信。

2. `services/api`（FastAPI）
   - 流程校验 API。
   - 运行生命周期管理 API。
   - 从 Phase C 开始将元数据存储到 SQLite。

3. `apps/agent`（Python + Playwright）
   - 执行流程步骤。
   - 返回节点级日志与最终状态。

4. `apps/recorder-extension`（MV3）
   - 捕获选择器候选与用户操作。
   - 向设计器发送录制载荷。

5. `packages/flow-schema`
   - DSL Schema 的唯一事实源（source of truth）。
   - 包含 Schema 示例与迁移说明。

## V1 数据流

1. Designer 将流程 JSON 发送到 `POST /api/v1/flows/validate`。
2. Designer 通过 `POST /api/v1/runs` 启动运行。
3. API 分发到 Agent 执行器接口。
4. Agent 返回运行事件。
5. API 通过 `GET /api/v1/runs/{runId}` 暴露运行状态。

## 契约规则

1. 每个流程载荷都必须包含 `schemaVersion`。
2. 每个节点必须包含 `id`、`type`、`config`。
3. 每个运行事件必须包含 `timestamp`、`runId`、`nodeId`、`level`、`message`。

## 错误模型

所有 API 错误必须遵循：

```json
{
  "code": "FLOW_VALIDATION_FAILED",
  "message": "Start node is missing",
  "details": {},
  "requestId": "req_123"
}
```
