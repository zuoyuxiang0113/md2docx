# 开发指南

直接使用软件请下载 [Release 发行包](https://github.com/zuoyuxiang0113/md2docx/releases)。本页面向需要从源码运行、修改或构建项目的开发者。

## 环境准备

- Python 3.10 或以上。
- Node.js 22.12 或以上及 npm，具体依赖要求以 `desktop/package-lock.json` 为准。
- Pandoc：开发时可安装到 PATH 或设置 `MD2DOCX_PANDOC`；打包脚本要求 `runtime/pandoc/pandoc.exe` 存在。

Pandoc EXE、Node 依赖和发行目录不进入源码仓库。新克隆的仓库需要自行准备依赖。Pandoc 可从 [官方发布页](https://github.com/jgm/pandoc/releases) 获取，当前发行包使用 3.12.1；打包时请保留对应版权和许可证文件。

在仓库根目录安装 Python 依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
```

## 运行 CLI

在仓库根目录执行：

```powershell
python cli/md2docx.py doctor --json
python cli/md2docx.py convert path/to/input.md --config profiles/default.json --output output/result.docx
python cli/md2docx.py batch path/to/markdown-folder --config profiles/default.json --output-dir output
```

更多参数见 [CLI 文档](cli.md)。

## 运行桌面客户端

```powershell
cd desktop
npm ci
npm run dev
```

开发启动器运行 Vite 并启动 Electron，默认端口为 5173，可通过应用设置或 `MD2DOCX_PORT` 修改。

开发桌面端优先使用 `release/cli/md2docx/md2docx.exe`；未生成该目录包时会寻找 Python。因此，修改转换核心后若已有 CLI 目录包，需要重新构建该包，详见 [打包说明](packaging.md)。

## 目录与数据

| 目录 | 用途 |
| --- | --- |
| `core/` | 配置消费、转换、DOCX 处理和错误模型 |
| `cli/` | 命令行参数、JSON 输出和批量任务 |
| `desktop/` | Electron 主进程、IPC 和 React 界面 |
| `profiles/` | 开发示例配置 |
| `website/` | 官网静态资源 |
| `scripts/`、`packaging/` | 构建脚本与 PyInstaller 配置 |
| `runtime/` | 本地准备的打包运行时 |
| `release/` | 构建生成的分发制品 |

桌面端真实用户数据在 `%APPDATA%\md2docx`，不写入仓库中的示例配置。核心默认配置来自 `core/defaults.json`。字段实现情况见 [配置消费说明](config-consumption.md)。

## 构建 Windows 发行包

回到仓库根目录，准备好 `runtime/pandoc/pandoc.exe` 后执行：

```powershell
python -m pip install ".[build]"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-cli.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-desktop-portable.ps1
```

先构建 CLI，再构建桌面便携版：

- CLI 输出：`release/cli/md2docx/`。
- 桌面输出：`release/desktop/MD2DOCX-portable/`。

两个版本都需要完整目录。压缩后作为 GitHub Release 附件上传。详见 [打包说明](packaging.md)、[发布清单](release-checklist.md) 和 [第三方许可证清单](third-party-license-checklist.md)。

## 官网部署

官网地址：https://md2docx.zuoyuxiang.me/ 。Cloudflare Worker 名称为 `md2docx`，`wrangler.toml`、`worker.js` 仅部署 `website/` 静态资源。

本地已登录 Cloudflare 时，在仓库根目录运行：

```powershell
npx wrangler@4 deploy
```

GitHub Actions 工作流为 `.github/workflows/deploy-website.yml`，修改 `main` 上的官网或部署文件会触发，也可手动运行。需要以下仓库 Actions Secrets：

- `CLOUDFLARE_API_TOKEN`：部署用的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare 账户 ID。

未配置凭据时，工作流会跳过部署。确认是否真正部署应检查 `Deploy Worker` 步骤。Release 附件上传与官网部署是独立流程。
