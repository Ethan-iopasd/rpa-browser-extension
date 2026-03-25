# Katalon 接入阶段 4（本地模板管理）

日期：2026-02-23  
范围：在 Designer 里支持本地可持久化模板管理。

## 已完成

1. 模板本地存储：
   - `localStorage` key：`rpa.flow.katalon.templates.v1`
2. 模板操作：
   - `保存为模板`
   - `更新模板`
   - `重命名`
   - `删除模板`
3. 模板类型区分：
   - 内置模板（只读）
   - 自定义模板（可改名、更新、删除）

## 行为说明

1. “保存为模板”会读取当前 `subflow.config.katalon` 并生成一个自定义模板。
2. “更新模板”会用当前节点配置覆盖已选中的自定义模板。
3. “重命名/删除”仅对自定义模板生效，内置模板按钮会禁用。
4. 关闭页面后模板仍保留（同浏览器本地）。

## 文件

1. `apps/designer/src/features/designer/components/NodePanel.tsx`
