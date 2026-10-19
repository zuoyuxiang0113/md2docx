# 发布前清单

## 仓库

- 源码仓库提交 `core`、`cli`、`desktop/src`、文档、示例、构建脚本和配置协议。
- 不提交 `desktop/node_modules`、`desktop/dist`、`build`、Python 缓存或用户数据。
- `release/cli` 和 `release/desktop` 是构建产物，作为 GitHub Release 附件发布，不放入普通源码提交。
- 官网只提交 `website/`、`worker.js` 和 `wrangler.toml`；Cloudflare Worker 不读取源码目录。
- 内置 Pandoc 和 Electron 会产生较大的二进制体积；需要随源码分发时使用 Git LFS，推荐只在 Release 附件中提供完整制品。

## 构建

```powershell
python -m pip install ".[build]"
cd desktop
npm ci
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-cli.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-desktop-portable.ps1
```

## 发布前验证

```powershell
release\cli\md2docx\md2docx.exe --version --json
release\cli\md2docx\md2docx.exe doctor --json
release\desktop\MD2DOCX-portable\MD2DOCX.exe
```

- 用中文 Markdown、图片、表格、代码块和公式各转换一次。
- 确认桌面版首次启动不白屏，能读取 `%APPDATA%\md2docx`。
- 确认完整复制 `MD2DOCX-portable` 目录后仍可启动；不能只复制 EXE。
- 确认 `THIRD-PARTY-NOTICES.txt`、Electron `LICENSE` 和 `LICENSES.chromium.html` 随桌面制品保留。
- 发布说明写明版本、Windows 架构、Pandoc 版本、已知限制和数据目录。

## 仓库安全

- 提交前检查 `git diff --cached`，确认没有用户路径、日志、诊断报告、Markdown 私人内容或 DOCX。
- 不把 `%APPDATA%\md2docx` 下的文件复制进仓库。
- 发布 Token、签名证书和私钥只放在本机或 CI Secret，不进入仓库。
