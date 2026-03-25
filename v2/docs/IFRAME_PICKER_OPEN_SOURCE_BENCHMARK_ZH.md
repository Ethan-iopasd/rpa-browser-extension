# iframe 嵌套拾取开源对标清单（强制）

更新时间：2026-02-23

## 目标问题

在复杂页面中稳定拾取元素，要求同时满足：

1. 支持多层嵌套 iframe。
2. 自动生成多候选 selector（含 fallback）。
3. 失败后可自动降级重试。
4. 对非开发用户可用（无需手动切 frame、无需手写 selector）。

## 开源对标结论（已调研）

### 1) Playwright（首选规则来源）

- 价值：
  - 官方 codegen 会自动生成定位，并优先 role/text/testid，冲突时会增强唯一性。
  - 官方 `FrameLocator` 明确支持 iframe 链式定位，且有 strict 行为约束。
- 可复用点：
  - locator 生成优先级（role/text/testid > css/xpath）。
  - `frameLocator(...).getBy...` 的输出风格与数据结构。
- 许可证：Apache-2.0。

### 2) Chrome DevTools Recorder（首选拾取内核来源）

- 价值：
  - Recorder 采用“注入到目标页 + 会话聚合”的架构，天然适合复杂页面事件采集。
  - 注入端有独立 selector 计算模块（ARIA/CSS/Text/XPath/Pierce）。
  - 默认 selector 类型顺序可直接作为 fallback 参考。
- 可复用点：
  - 注入式采集（RecordingClient）与消息回传结构。
  - selector 多路生成 + 候选排序思路。
  - 多目标/多上下文会话管理模型（RecordingSession）。
- 许可证：BSD-3-Clause。

### 3) Selenium IDE（作为 frame 语义对照）

- 价值：
  - `select frame` 语义清晰，明确了“嵌套 frame 需要逐层进入”这一事实。
  - 作为回放层的兼容思路（frame 栈）可借鉴。
- 可复用点：
  - frame 上下文切换语义与回退语义（parent/top）。
- 许可证：Apache-2.0。

### 4) Puppeteer Replay（导出与回放生态）

- 价值：
  - 与 Chrome Recorder JSON 兼容，便于后续导出/回放/CI 集成。
- 可复用点：
  - 录制数据结构与导出链路。
- 许可证：Apache-2.0。

### 5) 反例：Headless Recorder（不作为主线）

- 现状：
  - 项目已归档（read-only，停止维护）。
- 结论：
  - 只能做参考，不作为核心依赖。

## 采用策略（本项目执行）

1. 拾取内核采用「DevTools Recorder 注入式思路」：每个 frame 内采集，统一回传。
2. 选择器策略采用「Playwright codegen 风格」：优先 role/text/testid，再 fallback 到 css/xpath。
3. 数据输出统一包含：
   - `selectorCandidates`
   - `playwrightCandidates`
   - `framePath`
   - `frameLocatorChain`
4. UI 只允许一个顶层工具条，禁止在子 iframe 内重复渲染大工具栏。
5. 生成脚本默认输出 `frameLocator(...).locator(...)` 风格，避免手动切 frame。

## 非目标（避免浪费）

1. 不再新增“用户手动添加 switchFrame 节点”的主流程依赖。
2. 不以“只对简单单页可用”的方案作为完成标准。
3. 不接入已停止维护的项目作为核心能力。
