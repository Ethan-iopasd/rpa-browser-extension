# Katalon 接入阶段 2（Designer 面板）

日期：2026-02-23  
范围：在 Designer 中提供可视化 Katalon 配置，不改 DSL 节点类型。

## 已完成

1. `subflow` 节点新增 Katalon 配置区（可开关）：
   - 文件：`apps/designer/src/features/designer/components/NodePanel.tsx`
2. 支持字段：
   - `command`
   - `projectPath`
   - `testSuitePath`
   - `testSuiteCollectionPath`
   - `executionProfile`
   - `browserType`
   - `reportFolder`
   - `retry`
   - `extraArgs`（空格分隔）
   - `consoleLog`
   - `failOnNonZeroExit`
3. 画布节点摘要支持显示 Katalon 信息：
   - 文件：`apps/designer/src/features/designer/components/ReactFlowCanvas.tsx`

## 使用方式

1. 在流程中选中一个 `subflow` 节点。
2. 在右侧 `Node Config` 面板找到 `Katalon 执行`。
3. 把开关从“关闭（普通子流程）”改为“开启（Katalon CLI）”。
4. 填写 `projectPath` 与 `testSuitePath`（或 `testSuiteCollectionPath`）。
5. 保存流程并运行。

## 存储格式

仍写入原有 `subflow` 节点的 `config`，例如：

```json
{
  "type": "subflow",
  "config": {
    "flowId": "flow_sub_001",
    "timeoutMs": 600000,
    "outputVar": "katalonResult",
    "katalon": {
      "command": "katalonc",
      "projectPath": "{{katalonProjectPath}}",
      "testSuitePath": "Test Suites/Smoke",
      "executionProfile": "default",
      "browserType": "Chrome",
      "consoleLog": true,
      "failOnNonZeroExit": true
    }
  }
}
```

## 说明

1. 本阶段只做了 Designer 可视化配置，不新增节点类型。
2. 运行侧使用阶段 1 已接入的 Agent Katalon 执行分支。
