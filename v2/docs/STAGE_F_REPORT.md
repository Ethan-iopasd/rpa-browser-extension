# 阶段 F 完成报告：任务调度与运行中心

完成日期：2026-02-21

## 1. 交付范围

1. 任务模型：支持 `manual/scheduled/batch` 三类任务。
2. 调度与并发：内置轮询调度器 + 工作队列 + 最大并发控制。
3. 失败重跑：任务级重试策略（`maxRetries/retryDelayMs`）与接口触发重跑。
4. 运行中心：运行列表、事件过滤、日志导出（`jsonl/csv`）、统计与告警接口。
5. 前端面板：Designer 新增 Task Center 面板（创建、触发、暂停/恢复、重跑、统计、告警）。

## 2. 关键接口

1. `POST /api/v1/tasks`
2. `GET /api/v1/tasks`
3. `POST /api/v1/tasks/{task_id}/trigger`
4. `POST /api/v1/tasks/{task_id}/retry-last-failed`
5. `GET /api/v1/runs?status=&taskId=&flowId=`
6. `GET /api/v1/runs/{run_id}/events?level=&nodeId=&nodeType=&keyword=`
7. `GET /api/v1/runs/{run_id}/export?format=jsonl|csv`
8. `GET /api/v1/runs/stats`
9. `GET /api/v1/runs/alerts`

## 3. 核心文件

1. `services/api/app/services/task_service.py`
2. `services/api/app/repositories/task_repository.py`
3. `services/api/app/repositories/run_repository.py`
4. `services/api/app/routers/tasks.py`
5. `services/api/app/routers/runs.py`
6. `apps/designer/src/features/designer/components/TaskCenterPanel.tsx`

## 4. 验证结果

1. Python 测试：`18` 项通过。
2. Python 语法检查通过。
3. Designer `typecheck` 与 `lint` 通过。
