# Katalon 接入阶段 3（模板下拉 + 一键填充）

日期：2026-02-23  
范围：降低手工配置成本，让 `subflow.katalon` 可快速填充。

## 已完成

1. `subflow` 节点新增模板下拉：
   - 文件：`apps/designer/src/features/designer/components/NodePanel.tsx`
2. 新增“一键填充”按钮：
   - 选择模板后可直接写入 `config.katalon`。
3. 内置 3 个模板：
   - `Smoke / Chrome`
   - `Regression / Chrome`
   - `CI / Headless`

## 行为说明

1. 一键填充会把模板字段写入当前 `subflow.config.katalon`。
2. 若节点已填写 `projectPath` 或 `command`，一键填充会保留这两个已有值，避免覆盖本机路径与自定义命令。
3. 模板填充后仍可继续手动微调字段。

## 使用步骤

1. 选中 `subflow` 节点。
2. 打开 `Katalon 执行` 开关。
3. 在“模板”中选择一个模板。
4. 点击“`一键填充`”。
5. 根据项目实际情况修改 `projectPath`、`testSuitePath` 或 `testSuiteCollectionPath`。
