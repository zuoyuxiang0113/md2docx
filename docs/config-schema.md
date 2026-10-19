# Configuration Schema

当前唯一支持的配置版本是 `schemaVersion: 2`。

内置默认值唯一来源为 `core/defaults.json`：Python 配置校验读取该文件，Electron 直接加载，React 在构建时导入。正文默认行距为 1.5；一级标题默认段前 18pt、段后 8pt。已保存配置中的显式值优先于默认值。`profiles/default.json` 是对应的示例文件，不作为运行时默认值来源；发布时必须包含 `core/defaults.json`，Python 包已声明该资源。

顶层字段：

```json
{
  "schemaVersion": 2,
  "id": "thesis",
  "updatedAt": "2026-10-09T00:00:00Z",
  "page": {},
  "styles": {},
  "numbering": {},
  "options": {}
}
```

文件名主干是配置的唯一身份来源，例如 `thesis.json` 必须包含 `id: "thesis"`。JSON 不保存独立显示名称，界面直接显示文件名主干。`files` 和 `outputDirectory` 属于当前任务，不写入正式配置库。`name` 不属于当前协议，读取时会丢弃，保存时不会写回；其他未知字段保留，缺失字段从默认配置补齐。旧的 `version`、`numberHeadings` 和 `stripExistingHeadingNumbers` 不属于当前协议。

`page.preset` 允许 `A4`、`A5`、`Letter`，`page.orientation` 允许 `portrait`、`landscape`。`page.widthCm` 和 `page.heightCm` 是最终页面尺寸，预设只提供命名起点，因此用户修改宽高后会按自定义尺寸输出。`options.math` 允许 `omml`、`text`，图片对齐允许 `left`、`center`、`right`。页面尺寸、边距、字号和编号起始级别会进行数值校验；布尔字段和对象字段也会进行类型校验。

内容与样式使用固定对应关系：正文使用 normal、H1–H6 使用 heading1–heading6、表格使用 table、图表题注使用 caption。`elements` 已移除，旧输入中的该字段会被清除，不再改变输出。

字段的实际消费状态见 [`docs/config-consumption.md`](config-consumption.md)。页眉页脚、目录、分节、预览、Mermaid 策略等尚未实现的功能不进入当前正式配置协议。

保存时先写入同目录临时文件，再替换目标文件，避免产生半截 JSON。页眉、页脚、页码和目录当前不属于协议。
