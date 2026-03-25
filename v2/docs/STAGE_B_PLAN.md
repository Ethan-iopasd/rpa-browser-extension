# Stage B 详细计划

最后更新：2026-02-21

## 目标

搭建 V2 工程基础，确保后续功能开发不再因结构调整反复返工。

## 工作包

1. Monorepo 基线：
   - 统一根级 lint/typecheck/test/build/verify 脚本
   - 增加工作区级 lint/format 配置
2. 设计器骨架：
   - 启用严格 TS 配置
   - 前端分层目录（`app/core/features/shared`）
   - API 客户端抽象
3. API 骨架：
   - 后端分层目录（`routers/schemas/services/repositories/core`）
   - 应用工厂与统一错误包络
4. Agent 骨架：
   - 运行时分层目录（`adapters/runtime/executors/models`）
   - CLI 适配器与契约对齐的桩实现
5. 共享契约：
   - 基于 Schema 生成 TS/Python 模型
   - Schema 漂移检查脚本
6. 质量基线：
   - 工作区语法检查
   - Python 单测基线
   - CI 草案流程

## 退出标准

1. V2 结构固定并完成文档化。
2. 根命令可编排并执行质量检查。
3. API 与 Agent 暴露稳定契约，支撑下一阶段集成。
4. CI 工作流已定义，具备回归防护能力。
