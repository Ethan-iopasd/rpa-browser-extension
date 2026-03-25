# RPA 浏览器扩展（V2）

当前主开发目录是 `v2`，旧版 V1 已清理。

## 文档入口

1. 总说明与完整命令：`v2/README.md`
2. 本地环境引导：`v2/docs/LOCAL_BOOTSTRAP.md`
3. 桌面打包/发布/更新：`v2/README.md` 中“桌面版打包、发布与更新（Stage 3）”

## 本地开发（推荐：Python + uv）

### 1) 初始化依赖

```powershell
cd v2
pnpm install

uv python install 3.10
uv venv --python 3.10 .venv
.\.venv\Scripts\Activate.ps1
uv pip install -e ".\services\api[dev]" -e ".\apps\agent[dev]"
python -m playwright install chromium
```

### 2) 启动服务

终端 A（API）：

```powershell
cd v2\services\api
uvicorn app.main:app --reload --reload-dir app --port 8000
```

终端 B（Designer）：

```powershell
cd v2
pnpm --filter @rpa/designer dev
```

## 桌面打包（sidecar 方案）

```powershell
cd v2
pnpm release:desktop:sidecar
pnpm release:desktop
```

说明：

1. 构建机需要 Python（建议用 `uv` 管理）。
2. 客户机不需要安装 Python，安装包内已包含 API/Agent sidecar 与运行所需资源。

## 产物位置

1. 安装包目录：`v2\dist\desktop\<version>\bundle`
2. 发布清单：`v2\dist\desktop\<version>\desktop-release-manifest.json`
