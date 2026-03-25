# Beta 发布检查清单

发布窗口：2026-02-21

## 1. 代码与质量

1. Python 测试通过（`python -m unittest discover`）。
2. Python 语法检查通过（`scripts/python_syntax_check.py`）。
3. Designer `typecheck` 通过。
4. Designer `lint` 通过。

## 2. 功能验收

1. 流程创建 -> 校验 -> 运行成功。
2. 任务创建 -> 调度触发 -> 失败重跑可用。
3. 日志过滤与导出可用。
4. 运行统计与告警接口可用。
5. 凭据增删查与脱敏生效。

## 3. 稳定性与回归

1. 执行 `scripts/ops/soak_test.py` 并记录结果。
2. 执行 `scripts/ops/perf_benchmark.py` 并记录结果。
3. 执行 `scripts/ops/regression_gate.py`，失败即阻断发布。

## 4. 发布与升级

1. 执行 `scripts/release/build_beta_package.ps1` 生成 zip。
2. 在目标目录执行 `scripts/release/upgrade_beta.ps1` 验证升级。
3. 验证 `_backup/<timestamp>` 备份生成成功。
