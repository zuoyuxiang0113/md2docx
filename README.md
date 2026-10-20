# MD2DOCX

把 Markdown 转换为可编辑的 Word 文档，保存并复用你的排版方案。

MD2DOCX 是一个本地文档转换工具，提供 Windows 桌面版和独立 CLI。支持单文件与批量转换，可调整页面、正文、标题、表格、代码块、图片、公式及编号设置。

[官网](https://md2docx.zuoyuxiang.me/) · [下载 v0.2.0](https://github.com/zuoyuxiang0113/md2docx/releases/tag/v0.2.0) · [使用文档](#使用文档) · [问题反馈](https://github.com/zuoyuxiang0113/md2docx/issues)

## 下载

当前版本为 **v0.2.0 公开预览版**，发行包面向 Windows x64。

| 版本 | 适合谁 | 下载 |
| --- | --- | --- |
| 桌面版 | 通过图形界面添加文件、编辑样式和查看结果 | [Windows x64 桌面版 ZIP](https://github.com/zuoyuxiang0113/md2docx/releases/download/v0.2.0/MD2DOCX-v0.2.0-windows-x64-desktop.zip) |
| CLI 版 | 通过命令行、脚本或 Agent 批量处理文档 | [Windows x64 CLI ZIP](https://github.com/zuoyuxiang0113/md2docx/releases/download/v0.2.0/MD2DOCX-v0.2.0-windows-x64-cli.zip) |

发行包包含 Python、Pandoc 及转换依赖，无需另外安装。请**完整解压并保留目录中的全部文件**，不要只复制 EXE。Release 中的 `Source code` 是源码包，不是可直接运行的软件。

## 开始使用

### 桌面版

1. 下载并完整解压桌面版 ZIP，运行 `MD2DOCX.exe`。
2. 在「文档」页添加 Markdown 文件或文件夹，选择输出目录和配置。
3. 点击「开始转换」，在「结果」页查看输出、警告或错误。

需要调整排版时，在「配置」页双击一个配置，修改样式并保存，然后继续转换。

### CLI 版

在解压后的 CLI 目录中打开 PowerShell：

```powershell
# 检查运行环境
.\md2docx.exe doctor --json

# 转换单个文件
.\md2docx.exe convert "D:\docs\input.md" --config .\profiles\default.json --output "D:\output\result.docx"

# 批量转换目录中的 Markdown
.\md2docx.exe batch "D:\docs" --config .\profiles\default.json --output-dir "D:\output"
```

CLI 在标准输出返回 JSON，日志和进度写入标准错误，便于接入脚本和自动化流程。更多参数见 [CLI 使用说明](docs/cli.md)。

## 主要功能

- **本地处理**：文稿在本机转换，官网用于产品介绍和下载。
- **可复用排版**：调整页面尺寸、页边距、中英文字体、字号、行距和各类内容样式，保存为 JSON 配置。
- **批量转换**：添加多个文件或文件夹，设置同名文件处理和批量错误策略。
- **Word 自动编号**：按需启用标题自动编号。
- **配置管理**：创建、切换、导入、导出和管理样式配置。
- **结果与诊断**：查看逐文件结果、警告和错误，检测运行环境并导出诊断报告。

## 当前范围与数据位置

v0.2.0 是公开预览版。复杂表格、公式和其他复杂内容请检查最终 DOCX 排版；页眉、页脚、页码及目录配置暂未提供。

桌面端设置、样式配置和工作副本保存在 `%APPDATA%\md2docx`。默认输出目录为用户「文档」下的 `MD2DOCX` 文件夹，可在常规设置中修改。

## 使用文档

- [CLI 参数、批量策略与退出码](docs/cli.md)
- [JSON 配置协议](docs/config-schema.md)
- [应用设置与数据存储](docs/app-settings.md)
- [日志与诊断](docs/logging.md)

遇到问题时，请在 [Issues](https://github.com/zuoyuxiang0113/md2docx/issues) 提供版本、操作步骤和错误信息。诊断报告可从软件中导出，分享前请检查是否含有个人信息。

## 开发与构建

项目使用 Python 转换核心与 CLI、Electron + React 桌面客户端，以及 Pandoc 转换引擎。

源码运行、构建、目录说明和官网部署见 [开发指南](docs/development.md)；实现边界见 [架构说明](docs/architecture.md)。

## 许可证

项目源码使用 [MIT License](LICENSE)。随发行包提供的 Pandoc、Electron 和其他依赖按各自许可证分发，见 [第三方声明](THIRD-PARTY-NOTICES.txt)。
