# Architecture

```text
Agent / CLI
    ↓
cli/md2docx_cli.py
    ↓
core/md2docx_core.py
    ↓
Pandoc + python-docx + OOXML
    ↓
DOCX
```

Desktop flow:

```text
React Renderer
    ↓ whitelist IPC
Electron Main
    ↓ immutable project snapshot + explicit input list
CLI batch（每个任务仅启动一次）
    ↓
Python core
```

职责边界：

- `core` 只处理配置消费、Markdown 转换、DOCX 样式和警告；
- `cli` 只处理命令参数、退出码和 JSON 输出；
- `desktop` 只处理窗口、文件对话框、配置库和 IPC；
- Renderer 不执行 Python、Shell 或任意路径操作；
- `runtime` 只存放应用分发的外部运行时。
- 开发端找到 `release/cli/md2docx/md2docx.exe` 时优先调用目录包；没有目录包时调用系统 Python。发布端只调用 `resources/cli/md2docx.exe`，不会静默依赖系统 Python。环境检测通过内置 CLI 的 `doctor --json` 返回依赖版本。
- 桌面端通过 `batch --input-list` 一次提交完整任务；CLI 用 JSONL 报告逐文件结果。取消任务时 Electron 终止 CLI 及其 Pandoc 子进程树，并保留取消前已返回的文件结果。
- 配置方案固定使用 `schemaVersion: 2`；页眉、页脚、目录等未实现功能不进入当前正式配置协议。
- 文件列表和输出目录属于当前任务状态，保存配置时不会写入配置库。
- 日志和诊断不写入安装目录：应用/任务日志写入 Electron `userData/logs`，CLI 可通过 `MD2DOCX_LOG_DIR` 覆盖。
- 错误使用结构化 `ErrorItem`，日志使用 JSONL；Renderer 不自行解析 Pandoc 原始文本。
- 转换输出先写入同目录临时 DOCX，完成 DOCX 对象校验后再原子替换目标文件；验证失败不会覆盖已有输出。

## Desktop UI

- 默认窗口约 `1000 x 700`，顶部为紧凑菜单带与 Windows 原生窗口按钮。侧栏默认展开，可通过底部收缩按钮切换紧凑图标模式，收缩后仍保留全部导航入口。
- 主导航固定为配置、文档、结果、设置；启动页为文档，转换完成后才显示结果。
- 配置页内部分类为页面、正文、标题、表格、代码块、图片、公式、编号；转换使用固定样式对应关系。
- 设置页提供常规、运行环境、日志与诊断、关于几个入口；转换相关选项收敛在常规页中，应用使用唯一的紧凑窗口布局。
- 运行环境页检查 Python、Pandoc、python-docx 和 lxml，并显示版本与路径。
