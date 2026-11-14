# CLI

CLI 不依赖 Electron，可以在项目根目录独立运行。

```powershell
python cli/md2docx.py convert input.md --config profile.json --output result.docx
python cli/md2docx.py batch .\docs --config profile.json --output .\dist
python cli/md2docx.py doctor
python cli/md2docx.py --version
python cli/md2docx.py doctor --json
python cli/md2docx.py convert input.md --config - --output result.docx --progress jsonl
python cli/md2docx.py batch .\docs --config profile.json --output .\dist --on-conflict rename --batch-errors stop
python cli/md2docx.py batch --input-list .\inputs.json --config profile.json --output-dir .\dist --progress jsonl
```

`batch` 可以接收输入目录，也可以用 `--input-list` 接收明确文件列表。文件列表 JSON 使用 `{"files":["D:/docs/a.md","D:/docs/b.md"]}`；桌面端使用该形式把当前任务一次性交给 CLI，避免 Electron 逐文件重复启动 Python。

本地图片缺失策略通过 `--missing-images warning|stop` 指定，默认 `warning`。`stop` 在生成 DOCX 前返回 `IMAGE_NOT_FOUND`，并提供对应源码行号；批量继续或停止仍由 `--batch-errors` 控制。

退出码：

- `0`：成功；
- `2`：参数错误；
- `3`：配置错误；
- `4`：输入错误；
- `5`：输出错误；
- `6`：运行时错误；
- `7`：转换错误；
- `8`：批量部分失败；
- `9`：预留的取消分类；当前独立 CLI 没有显式的取消命令或 `KeyboardInterrupt` 到该退出码的映射，不应将外层调用者终止进程的机制视为 CLI 自身保证。

进入 CLI 主处理流程后的转换和诊断结果写入标准输出 JSON。`--progress jsonl` 将可选的结构化进度写入标准错误；普通应用日志和任务日志由 `JsonlLogger` 写入文件，位置见[日志文档](logging.md)。模块顶层的依赖导入失败发生在主处理流程之前，不在统一 JSON 错误返回的保证范围内。
批量结果同时返回 `status`、`total`、`processed` 和 `unprocessed`。`status` 为 `completed` 或 `partial`；使用 `--progress jsonl` 时，每个已处理文件还会发出 `event: "item"`，便于客户端保留已完成结果并显示进度。

输出冲突策略通过 `--on-conflict` 指定：`ask`、`overwrite`、`rename`、`skip`、`fail`。单文件命令默认使用 `ask`，遇到已存在输出时返回结构化错误，不会阻塞等待输入；批量命令默认使用 `skip`，适合无人值守运行。批量错误策略通过 `--batch-errors continue|stop` 指定，默认继续并汇总。

成功转换会在 DOCX 同目录生成同名 `.warnings.json` 报告。报告包含成功状态、输入/输出路径、配置元数据、配置快照、对象统计和警告。批量失败项有单独的报告写入路径，单文件在参数、配置、输入或转换阶段失败时不保证生成报告；已存在的输出文件被跳过时不会覆盖原文件。

DOCX 先在临时文件中处理并校验，再替换正式输出；CLI 随后写报告。DOCX 与报告分别采用原子替换，但不是同一个跨文件事务，因此报告写入失败时，正式 DOCX 可能已经存在。调用者应结合结果与产物状态处理，而不是把任何失败都等同于“未产生文件”。

`--config -` 从 stdin 读取 JSON，`--progress jsonl` 将阶段事件写入 stderr。参数错误、配置错误和转换错误都使用统一 JSON 结果；当前协议固定使用 schemaVersion 2 和正式退出码，旧版本配置不会自动迁移。
