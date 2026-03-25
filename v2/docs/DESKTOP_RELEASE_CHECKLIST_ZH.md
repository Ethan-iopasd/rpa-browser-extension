# Desktop 发布检查清单（阶段 3）

更新时间：2026-02-24

## 1. 版本与分支

1. 确认发布分支为 `release/beta-desktop`。
2. 确认 `apps/desktop/package.json` 的版本号已更新。
3. 确认发布说明和变更记录已同步。

## 2. 质量门禁

1. `pnpm --filter @rpa/designer typecheck`
2. `pnpm --filter @rpa/desktop typecheck`
3. `python scripts/python_syntax_check.py`
4. `cargo check`（目录：`apps/desktop/src-tauri`）
5. `pnpm --filter @rpa/designer build`

## 3. 安装包构建

1. 执行：
   - `pnpm release:desktop`
2. 确认产物目录：
   - `dist\desktop\<version>\bundle`
3. 确认清单文件：
   - `dist\desktop\<version>\desktop-release-manifest.json`
4. 确认清单中 `artifacts` 列表含 SHA256。

## 4. 冒烟验收

1. 在干净机器安装桌面包并启动。
2. 首次启动后可自动拉起 API。
3. Designer 可打开 `/dashboard` 并成功调用 API。
4. 设置页可查看桌面运行诊断信息。
5. 可执行“重启桌面服务”和“导出诊断包”。

## 5. 发布后回滚预案

1. 保留上一个稳定安装包与清单。
2. 若新包阻断，立即回退到上一个稳定版安装包。
3. 用诊断包定位问题后再重新发布补丁版本。
