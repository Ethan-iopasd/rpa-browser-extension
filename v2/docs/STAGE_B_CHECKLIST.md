# Stage B 检查清单

最后更新：2026-02-21

## B1 Monorepo 基线

- [x] 工作区包布局定稿（`apps/services/packages/docs/tests/scripts`）。
- [x] 根级 lint/typecheck/test/build/verify 脚本完成。
- [x] 共享 lint 与格式化配置已添加。

## B2 设计器骨架

- [x] 启用严格 TypeScript 配置。
- [x] 启用 ESLint 命令。
- [x] 应用分层为 `app/core/features/shared`。
- [x] API 客户端层与 UI 层隔离。

## B3 API 骨架

- [x] 已建立分层：`routers/schemas/services/repositories/core`。
- [x] 已实现应用工厂模式。
- [x] 已实现统一错误契约。
- [x] health/flow/run 路由已接入服务层。

## B4 Agent 骨架

- [x] 已建立分层：`adapters/runtime/executors/models`。
- [x] CLI 适配器可委派给 runtime。
- [x] 桩执行器返回契约对齐的运行事件。

## B5 共享契约

- [x] 提供 TS/Python 的 Schema 生成脚本。
- [x] 已添加 Schema 漂移检查脚本（`check:sync`）。
- [x] 生成产物已纳入仓库跟踪。

## B6 质量与 CI

- [x] 已添加 Python 单测基线。
- [x] 已添加工作区语法检查脚本。
- [x] 已提供 lint/typecheck/test/build 的 CI 草案流程。
