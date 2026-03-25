# RPA Flow Agent

该模块提供 V2 执行内核（阶段 C）：

- 执行状态机：`pending/running/success/failed/canceled`
- 9 类基础节点执行器：`start/end/navigate/click/input/wait/extract/if/loop`
- 节点级超时、重试与错误码分类
- 结构化运行事件日志输出
- 可选 Playwright 真实浏览器执行（`navigate/click/input/wait/extract`）

## 项目结构

- `agent/adapters`：CLI 或外部集成入口。
- `agent/runtime`：运行时编排层。
- `agent/executors`：节点执行实现。
- `agent/models`：运行契约与流程模型。

## 运行

1. `cd v2`
2. `uv python install 3.10`
3. `uv venv --python 3.10 .venv`
4. `.\.venv\Scripts\Activate.ps1`
5. `uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"`
6. 安装浏览器内核（仅真实浏览器模式需要）：`playwright install chromium`
6. `cd apps/agent`
7. `rpa-agent --flow ..\..\packages\flow-schema\examples\minimal.flow.json --browser-mode auto`

可选运行参数：

- `--max-steps`：最大执行步数（默认 `1000`）
- `--default-timeout-ms`：节点默认超时（默认 `5000`）
- `--default-max-retries`：节点默认重试次数（默认 `0`）
- `--browser-mode`：`auto/real/simulate`
- `--headed`：启用可视化浏览器窗口（默认无头）

## Katalon 接入（MVP）

当前支持通过 `subflow` 节点触发 Katalon CLI 执行，无需新增节点类型。

示例节点配置：

```json
{
  "id": "n_katalon",
  "type": "subflow",
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
      "consoleLog": true
    }
  }
}
```

说明：

- `projectPath` 必填，且必须是本机存在的 Katalon 项目目录。
- `testSuitePath` 与 `testSuiteCollectionPath` 至少填一个。
- `command` 可不填，默认读取环境变量 `RPA_KATALON_COMMAND`，再回退到 `katalonc`。
- `outputVar` 可选，设置后会写入执行结果（退出码、耗时、报告目录、日志尾部）。

## 输出

向 stdout 打印 JSON 运行事件。

## 质量命令

1. `python -m compileall agent`
2. `uv pip install -e ".\apps\agent[dev]"`
3. `ruff check agent`
4. `mypy agent`


