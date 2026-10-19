# Windows CLI 目录包

构建脚本：`scripts/build-cli.ps1`；PyInstaller 配置：`packaging/md2docx.spec`。

建议使用独立构建环境：

```powershell
python -m venv build/venv
build/venv/Scripts/python.exe -m pip install ".[build]"
./scripts/build-cli.ps1 -Python ./build/venv/Scripts/python.exe
```

输出目录：

```text
release/cli/md2docx/
├─ md2docx.exe
├─ _internal/          # Python、第三方依赖、core/defaults.json
├─ runtime/pandoc/     # pandoc.exe 和许可证
├─ profiles/default.json
└─ THIRD-PARTY-NOTICES.txt
```

必须保留整个目录，不可只复制 EXE。Pandoc 按 EXE 所在目录定位，不依赖当前工作目录。内置 `doctor` 检查打包进程的 Python 与模块，不执行自身 EXE 的 `-c` 命令。

开发 Electron 优先发现上述 CLI 包。修改 Python 后需要重新构建目录包，才能让桌面端使用新转换核心。`scripts/build-desktop-portable.ps1` 会将 Electron、前端构建结果、默认配置和完整 CLI 目录组装到 `release/desktop/MD2DOCX-portable/`。正式安装器仍待后续打包工具生成。

构建成功仅确认生成制品，不代表无 Python 环境、Word/WPS 或转换功能已验收。正式发布前还需要干净 Windows 环境验收和完整第三方许可证审核。

Electron 发布资源还必须包含 `resources/core/defaults.json`。开发环境从项目根目录读取默认配置，发布环境从 `process.resourcesPath/core/defaults.json` 读取。
