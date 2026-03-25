# 原生桌面拾取器实现说明（Stage 1-5）

## 目标

- 在桌面端实现“可真正点选页面元素”的原生拾取能力。
- 不依赖浏览器扩展 `chrome.*` API。
- 保持与现有选择器模型兼容：`selectorCandidates / playwrightCandidates / framePath / frameLocatorChain`。

## 架构概览

1. Designer 发起拾取会话（`POST /api/v1/picker/sessions`）。
2. API 后台线程执行 Agent 原生拾取任务。
3. Agent 使用 Playwright 打开页面并注入拾取脚本，用户点击后返回 `PickerResult`。
4. Designer 轮询会话状态（`GET /api/v1/picker/sessions/{id}`），成功后回填当前节点配置。
5. 用户可取消（`POST /api/v1/picker/sessions/{id}/cancel`）。

## 关键代码

1. API 路由：
   - `services/api/app/routers/picker.py`
2. API 会话服务与状态机：
   - `services/api/app/services/picker_service.py`
3. API 会话存储（持久化到 `.runtime/picker_sessions.json`）：
   - `services/api/app/repositories/picker_repository.py`
4. Agent 原生拾取执行：
   - `apps/agent/agent/runtime/picker.py`
5. Designer 接入：
   - `apps/designer/src/core/api/picker.ts`
   - `apps/designer/src/features/designer/hooks/useDesignerState.ts`
   - `apps/designer/src/features/designer/DesignerPage.tsx`

## 会话状态

- `pending`：会话已创建，等待执行。
- `running`：浏览器已启动，等待用户点选。
- `succeeded`：拾取成功，`result` 可用。
- `failed`：执行失败，查看 `errorCode/errorMessage/diagnostics`。
- `cancelled`：用户取消或会话被中止。

## 错误码

- `PICKER_INVALID_PAYLOAD`
- `PICKER_SESSION_NOT_FOUND`
- `PICKER_RUNTIME_UNAVAILABLE`
- `PICKER_TIMEOUT`
- `PICKER_CANCELED`
- `PICKER_EXECUTION_FAILED`

## 验证与测试

1. TypeScript：
   - `pnpm --filter @rpa/designer typecheck`
2. Python 语法：
   - `python scripts/python_syntax_check.py`
3. 拾取会话单测：
   - `python -m unittest v2/tests/test_picker_service.py`

## 已知边界

1. 复杂跨域 iframe 页面仍可能受站点策略影响。
2. 若未安装 Playwright 浏览器内核，需要先执行：
   - `python -m playwright install chromium`
3. 拾取窗口关闭或超时会进入 `cancelled/failed`，前端会展示可读错误信息。

