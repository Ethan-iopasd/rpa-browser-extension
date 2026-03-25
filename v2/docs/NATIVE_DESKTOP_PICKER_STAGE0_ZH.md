# 原生桌面拾取器 Stage 0（协议冻结）

## 目标

- 冻结桌面原生拾取器的统一结果协议 `PickerResult`。
- 保证 Designer / API / Agent 三端字段一致，后续阶段只实现流程，不再改字段名。

## Stage 0 范围

- 定义并落地共享字段模型：
  - `PickerSelectorCandidate`
  - `PickerFrameSegment`
  - `PickerFrameLocatorSegment`
  - `PickerResult`
- 不包含会话路由、Playwright 拾取执行、桌面 UI 行为。

## 协议（冻结版）

```json
{
  "selector": "role=button[name='Submit']",
  "selectorType": "playwright",
  "selectorCandidates": [
    { "type": "playwright", "value": "role=button[name='Submit']", "score": 0.92, "primary": true },
    { "type": "css", "value": "button[type='submit']", "score": 0.74, "primary": false }
  ],
  "playwrightPrimary": { "type": "playwright", "value": "role=button[name='Submit']", "score": 0.92, "primary": true },
  "playwrightCandidates": [
    { "type": "playwright", "value": "role=button[name='Submit']", "score": 0.92, "primary": true }
  ],
  "frameLocatorChain": [
    {
      "depth": 0,
      "hint": "checkout-iframe",
      "crossOrigin": false,
      "index": 0,
      "primary": "iframe[name='checkout']",
      "selectorCandidates": [
        { "type": "css", "value": "iframe[name='checkout']", "score": 0.85, "primary": true }
      ]
    }
  ],
  "pageUrl": "https://example.com/checkout",
  "framePath": [
    { "index": 0, "hint": "checkout-iframe", "name": "checkout", "crossOrigin": false }
  ],
  "framePathString": "top > checkout",
  "elementMeta": {
    "tagName": "button",
    "text": "Submit"
  }
}
```

## 字段约束

- `selector`: 非空，最终执行的主选择器。
- `selectorType`: `css | xpath | text | role | playwright`。
- `selectorCandidates`: 候选列表，优先返回去重后的稳定候选。
- `playwrightPrimary/playwrightCandidates`: 可选，存在时优先用于 Playwright 执行。
- `frameLocatorChain`: iframe 定位链，包含 `crossOrigin` 语义。
- `framePath/framePathString`: 仅用于诊断与可视化，不替代执行链。
- `elementMeta`: 调试辅助信息，允许扩展键值。

## 跨端落地点

- Designer TS 类型：
  - `apps/designer/src/shared/types/picker.ts`
- API Pydantic 模型：
  - `services/api/app/schemas/contracts.py`
- Agent Pydantic 模型：
  - `apps/agent/agent/models/contracts.py`

## 验收标准（Stage 0 完成）

- 三端均存在同名核心模型，字段语义一致。
- 设计器侧拾取结果解析逻辑直接引用统一 TS 类型。
- Python 语法检查 + TypeScript typecheck 通过。

