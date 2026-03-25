# React Flow 迁移报告（Designer）

更新时间：2026-02-23

## 1. 基线问题

- 旧画布（`CanvasPanel`）拖拽使用手写坐标换算，存在坐标系错位风险。
- 拖拽过程会频繁触发全量状态更新，节点较多时交互流畅度下降。
- 右侧圆点新增与连线行为在不同入口下不一致，使用成本高。

## 2. 迁移目标

- 用 `@xyflow/react` 替换默认画布交互层。
- 保留现有 `useDesignerState` action 与 `FlowModel` 数据契约。
- 支持节点拖拽、边连接、边中点插入节点、右侧圆点新增并自动连线。
- 保留回退路径（经典画布）以降低切换风险。

## 3. 关键改动

### 3.1 依赖与入口

- 新增依赖：`@xyflow/react`（`v2/apps/designer/package.json`）。
- `DesignerPage` 增加画布引擎切换（`React Flow` / `经典画布`）：
  - `v2/apps/designer/src/features/designer/DesignerPage.tsx`
  - `v2/apps/designer/src/features/designer/utils/canvasEngine.ts`

### 3.2 新画布实现

- 新增 React Flow 画布组件：
  - `v2/apps/designer/src/features/designer/components/ReactFlowCanvas.tsx`
- 能力覆盖：
  - 节点拖拽（`onNodeDragStop` 回写位置）
  - 边连接（`onConnect` -> `onAddEdge`）
  - 节点/边选中联动（`onSelectNode` / `onSelectEdge`）
  - 右上角 `+` 从源节点新增下游并自动连线
  - 边中点 `+` 按当前插入类型执行 `insertNodeOnEdge`
  - 顶部面板快速新增节点 / 配置插入类型

### 3.3 映射适配层

- 新增双向映射工具：
  - `v2/apps/designer/src/features/designer/utils/flowAdapter.ts`
- 包含：
  - `flowToReactFlowNodes`
  - `flowToReactFlowEdges`
  - `applyReactFlowPositionsToFlow`

### 3.4 迁移过程中的质量修复

- 修复 `selector` 候选默认主项在严格类型下的潜在空值问题：
  - `v2/apps/designer/src/features/designer/utils/selector.ts`
  - `v2/apps/designer/src/features/designer/components/NodePanel.tsx`
- `NodePanel` 候选 ID 生成改为稳定 `useRef` 计数，避免 `Date.now()` purity lint。
- `TaskDetailPage` 进行结构化重写，恢复类型与语法稳定：
  - `v2/apps/designer/src/features/tasks/TaskDetailPage.tsx`
- 清理 `RunConsolePanel` 尾部异常字符：
  - `v2/apps/designer/src/features/designer/components/RunConsolePanel.tsx`

## 4. 测试与验证

已执行并通过：

1. `pnpm --filter @rpa/designer lint`
2. `pnpm --filter @rpa/designer typecheck`
3. `pnpm --filter @rpa/designer test`
4. `pnpm --filter @rpa/designer build`

新增测试：

- `v2/apps/designer/tests/flowAdapter.test.ts`（映射与坐标回写）
- `v2/apps/designer/tests/canvasEngine.test.ts`（引擎选择回退逻辑）
- 同步修复：
  - `v2/apps/designer/tests/NodePanel.test.tsx`

## 5. 对应 1-10 执行状态

1. 基线确认：已完成  
2. 引入 React Flow：已完成  
3. 建立适配层：已完成  
4. MVP 交互落地：已完成  
5. 对齐 action 与验证：已完成  
6. 自定义节点/边：已完成  
7. 入口切换与回退：已完成  
8. 补充测试：已完成  
9. 旧实现降级为回退路径：已完成（默认使用 React Flow）  
10. 输出报告与结果：已完成  

## 6. 备注

- 生产构建存在 chunk size 警告（>500kB），当前不影响功能，可后续按需做动态拆包。
