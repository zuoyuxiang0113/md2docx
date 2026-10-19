# MD2DOCX

MD2DOCX 是一个本地 Markdown 到 DOCX 转换工具。CLI 是主产品，Python 负责转换核心，Electron + React 提供桌面客户端，Pandoc 负责 Markdown 到 DOCX 的基础转换。

官网：[md2docx.zuoyuxiang.me](https://md2docx.zuoyuxiang.me/)
源码：[github.com/zuoyuxiang0113/md2docx](https://github.com/zuoyuxiang0113/md2docx)

## CLI

```powershell
python cli/md2docx.py doctor
python cli/md2docx.py convert input.md --config profile.json --output result.docx
python cli/md2docx.py batch .\docs --config profile.json --output .\dist
python cli/md2docx.py batch --input-list .\inputs.json --config profile.json --output-dir .\dist
python cli/md2docx.py --version
```

配置协议、架构和命令说明见：

- [docs/architecture.md](docs/architecture.md)
- [docs/config-schema.md](docs/config-schema.md)
- [docs/cli.md](docs/cli.md)
- [docs/logging.md](docs/logging.md)
- [docs/packaging.md](docs/packaging.md)
- [docs/app-settings.md](docs/app-settings.md)
- [docs/third-party-license-checklist.md](docs/third-party-license-checklist.md)

## Desktop

```powershell
cd desktop
npm install
npm run dev
```

桌面端的用户配置保存到 Electron `userData/profiles`，根目录 `profiles` 仅为开发示例。

## Release

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-cli.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-desktop-portable.ps1
```

CLI 目录包生成到 `release/cli/md2docx/`，桌面便携版生成到 `release/desktop/MD2DOCX-portable/`。两个版本都必须保留完整目录，不能只复制单个 EXE。

发布前检查见 [docs/release-checklist.md](docs/release-checklist.md)。发行目录是构建产物，建议作为 GitHub Release 附件发布，不提交到源码仓库。

## Website

官网静态文件位于 `website/`，Cloudflare Worker 使用 `wrangler.toml` 和 `worker.js` 部署，Worker 名称为 `md2docx`。GitHub Actions 需要配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 两个仓库 Secret。
