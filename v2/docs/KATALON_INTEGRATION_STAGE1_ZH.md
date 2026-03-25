# Katalon 接入阶段 1（已落地）

日期：2026-02-23  
范围：先把执行链路打通，确保“可运行”，不一次性重构全部录制器。

## 1. 本阶段完成项

1. Agent 新增 Katalon 运行模块：`apps/agent/agent/runtime/katalon_runner.py`
2. 在 `subflow` 节点新增 Katalon 分支（向后兼容原有 inline subflow）：
   - 文件：`apps/agent/agent/executors/registry.py`
3. 增加自动化测试：
   - `tests/test_katalon_runner.py`
   - `tests/test_agent_engine.py` 新增 Katalon 子流程分支测试

## 2. 设计说明（为何这样做）

1. 不新增节点类型，避免同时改 DSL/前端/API/校验器，降低改动面。
2. 通过 `subflow.config.katalon` 触发外部执行，最小侵入，便于灰度。
3. 仍保留原有 `subflow` 的内联流程能力，旧流程不受影响。

## 3. 流程节点配置示例

```json
{
  "id": "n_katalon_smoke",
  "type": "subflow",
  "label": "Katalon Smoke",
  "config": {
    "timeoutMs": 600000,
    "outputVar": "katalonResult",
    "katalon": {
      "command": "katalonc",
      "projectPath": "{{katalonProjectPath}}",
      "testSuitePath": "Test Suites/Smoke",
      "executionProfile": "default",
      "browserType": "Chrome",
      "reportFolder": "Reports/smoke",
      "consoleLog": true,
      "retry": 1
    }
  }
}
```

## 4. 关键字段

1. `projectPath`：必填，本机 Katalon 项目目录，必须存在。
2. `testSuitePath` / `testSuiteCollectionPath`：至少一个必填。
3. `command`：可选，默认优先读 `RPA_KATALON_COMMAND`，再回退 `katalonc`。
4. `timeoutMs`：节点级超时，默认 10 分钟。
5. `outputVar`：可选，写入执行结果（退出码、耗时、报告目录、stdout/stderr 尾部）。

## 5. 本地联通清单（人工执行）

1. 安装 `Katalon Studio 11`。
2. 安装 `Katalon Web Recorder Plus` 浏览器扩展及 `Recording Engine`。
3. 确保命令行可运行（Windows PowerShell 示例）：
   - `katalonc -version`
4. 若未加 PATH，配置环境变量：
   - `$env:RPA_KATALON_COMMAND = 'C:\\path\\to\\katalonc.exe'`
5. 在 Agent 运行机器上准备 Katalon 项目目录，并把路径写入流程变量：
   - `katalonProjectPath`

## 6. 当前边界

1. 本阶段只接“执行”，未把 Web Recorder Plus 录制数据自动映射成流程节点。
2. 复杂录制策略（iframe/shadow/canvas）由 Katalon 录制侧保障；本项目当前负责调度与结果回传。
3. 报告聚合目前返回基础字段，下一阶段再做报告解析与可视化。

## 7. 下一阶段（阶段 2）

1. Designer 增加“Katalon 执行节点”可视化配置面板（仍映射到 `subflow`）。
2. API/Task 增加 Katalon 执行参数模板管理。
3. 结果页展示 Katalon 报告入口与失败定位信息（截图、失败步骤）。
