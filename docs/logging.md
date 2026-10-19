# 日志与诊断

## 范围

日志是诊断机制，不替代错误处理。CLI/Python 记录转换阶段和结构化错误，Electron Main 记录应用、IPC、运行环境和任务生命周期，Renderer 只显示进度、警告和可操作错误。

## 位置

桌面端日志写入：

```text
%APPDATA%\md2docx\logs\app.log
%APPDATA%\md2docx\logs\jobs\<jobId>.jsonl
```

CLI 默认使用同一位置，也可以通过 `MD2DOCX_LOG_DIR` 指定目录。普通应用日志和一次转换任务的 JSONL 日志使用相同字段：`timestamp`、`level`、`component`、`event`、`jobId`、`file`、`stage`、`code`、`message`。

未打包的 Electron 开发端默认写入 `%APPDATA%\md2docx\logs-dev`，它调用的 CLI 使用同一目录。正式应用使用 `logs`；显式设置 `MD2DOCX_LOG_DIR` 时优先使用该目录。独立 CLI 默认仍写入 `logs`。升级后首次启动会把旧版 `%APPDATA%\md2docx-desktop-demo` 中的设置、配置、工作副本与日志迁移到新目录并移除旧目录。

## 隐私和清理

- 只保留文件名，不记录默认完整路径；
- 不记录 Markdown 正文、图片内容或完整配置快照；
- 外部命令输出截断后写入；
- 默认保留 7 天，过期清理每小时最多执行一次；
- 应用日志和每个任务日志在约 5 MB 时轮换，每个文件最多保留 10 份归档，归档使用时间戳和随机标识；
- 关闭自动清理只停止按天清理，大小轮换和归档上限仍有效；
- 每个日志目录中的应用日志、任务日志和归档合计限制为 100 MB。写入前检查容量，超过时优先删除最旧日志；若文件被占用而无法腾出容量，则跳过本次写入。多个进程并发写入可能短暂超过目标，后续写入会继续清理；诊断报告不计入日志容量，也不参与自动删除。
- 手动清理只移除日志和归档，不删除诊断报告或其他用户文件；
- 读取日志会跳过损坏 JSONL 行，按实际时间排序、去重，并再次脱敏嵌套字段；
- 诊断导出只包含运行时摘要、配置 ID、失败文件名、错误代码/阶段和脱敏日志。

## 显示规则

- `INFO`：只用于阶段进度和任务状态；
- `WARNING`：显示在对应文件结果和任务总结；
- `ERROR`：显示在对应文件，包含错误代码、阶段和修复建议；
- `FATAL`：阻止任务继续并显示全局错误。

转换期间 Electron 通过 IPC 推送 `queued`、`preflight`、`load-config`、`pandoc`、`postprocess`、`validate`、`write-output` 和 `completed` 阶段事件。DOCX 在临时文件中完成校验，校验成功后才替换目标文件。日志页面进入时读取最近记录，不进行高频轮询。

## 桌面 IPC 错误协议

主进程通过统一注册函数返回 `{ success: true, data }` 或 `{ success: false, error }`。错误包含 `code`、`category`、`severity`、`jobId`、`file`、`stage`、`line`、`message`、`suggestions`、`recoverable` 和 `details`。不依赖 Electron 对抛出异常自定义属性的传输。

Preload 解包成功结果，并通过 `onOperationError` 向界面传递完整错误对象。界面显示简短原因、错误码和建议；主进程写入 `ipc_failed` 记录。日志写入失败不会覆盖原始操作错误。

日志页面支持对已加载记录按级别和任务 ID 筛选。诊断报告包含任务 ID、错误统计和应用设置摘要，不附带默认输出目录或完整用户配置。导出报告使用临时文件替换，清理日志失败会明确返回错误。

## CLI 示例

```powershell
python cli\md2docx.py convert input.md --config profile.json --output result.docx --progress jsonl
python cli\md2docx.py convert input.md --config - --output result.docx
python cli\md2docx.py doctor --json
```

`--progress jsonl` 写入标准错误，标准输出仍然是最终结果 JSON。CLI 默认使用扩展退出码分类。

## Settings Boundary

应用设置单独保存在 `%APPDATA%\md2docx\app-settings.json`，包含常规、转换和日志设置，不写入项目配置 JSON。转换设置中的同名文件策略、批量错误策略、转换前预检和成功后打开输出目录由 Electron 传给统一 CLI；项目配置仍只描述 DOCX 生成方式。
