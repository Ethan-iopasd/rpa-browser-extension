# @rpa/flow-schema

RPA Flow 的共享 DSL Schema 包。

## 内容

- `schema/flow.schema.json`：流程 DSL 的 JSON Schema。
- `examples/minimal.flow.json`：最小可运行示例。
- `generated/types.ts`：自动生成的 TypeScript 类型。
- `generated/flow_models.py`：自动生成的 Python 模型。

## 规则

1. 先在 Schema 中新增或修改字段，再实现业务逻辑。
2. 引入破坏性变更时必须提升 `schemaVersion`。

## 生成类型

1. `pnpm run generate:ts`
2. `pnpm run generate:py`
3. `pnpm run generate`
4. `pnpm run check:sync`
