# 配置字段消费矩阵

本文记录 `schemaVersion: 2` 配置字段在转换核心中的实际状态。状态只有三种：

- **已生效**：修改字段会改变转换结果或转换阶段行为；
- **部分生效**：只有部分语义已接入，剩余语义明确列出；
- **预留**：字段被校验并保存在配置中，但当前不会改变输出。

## 页面和基础样式

| 字段 | 状态 | 当前消费位置 | 说明 |
| --- | --- | --- | --- |
| `page.preset` | 已生效 | `core/md2docx_core.py::style_document` | 作为命名纸张预设和默认尺寸来源。 |
| `page.widthCm` / `page.heightCm` | 已生效 | `style_document` | 是最终页面尺寸；用户修改后不会被 `preset` 覆盖。 |
| `page.orientation` | 已生效 | `style_document` | 横向时交换宽高。 |
| `page.*MarginCm` | 已生效 | `style_document` | 写入每个 DOCX section 的页边距。 |
| `styles.normal` | 已生效 | `style_document` | 正文段落的字体、字号、颜色、行距、缩进和间距。 |
| `styles.heading1` - `styles.heading6` | 已生效 | `style_document` | 标题样式和标题段落间距。 |
| `styles.quote` | 已生效 | `style_document` | 引用段落的字体和左缩进。 |

## 表格、代码、图片和公式

| 字段 | 状态 | 当前消费位置 | 说明 |
| --- | --- | --- | --- |
| `styles.table` | 已生效 | `style_document` | 表格正文、对齐、内边距和三线表边框。 |
| `styles.table.headerBold` / `headerColor` | 已生效 | `style_document` | 第一行表头的加粗和颜色。 |
| `styles.codeBlock` | 已生效 | `style_document` | 代码字体、字号、颜色、背景、换行和语言标签。 |
| `options.images.alignment` | 已生效 | `style_document` | 图片段落左/中/右对齐。 |
| `options.images.maxWidthCm` | 已生效 | `style_document` | 超过最大宽度的图片会缩放。`0` 表示不限制。 |
| `options.images.keepRatio` | 已生效 | `style_document` | 图片被最大宽度约束时，控制是否按原比例调整高度。 |
| `options.images.captionEnabled` | 已生效 | `style_document` | 控制以“图 N/表 N”开头的题注样式。 |
| `options.math` | 已生效 | `convert` | `omml` 使用 Pandoc 数学转换；`text` 保留为文本形式。 |
| `options.mathFallback` | 已生效 | `convert` | OMML 转换失败时，`text` 尝试文本回退，`warning` 保留结构化转换错误。 |

## 编号

| 字段 | 状态 | 当前消费位置 | 说明 |
| --- | --- | --- | --- |
| `numbering.enabled` | 已生效 | `style_document` | 是否为标题附加 OOXML 多级编号。 |
| `numbering.stripExisting` | 已生效 | `convert` | 转换前移除 Markdown ATX 标题中的已有数字前缀。 |
| `numbering.startAt` | 已生效 | `apply_heading_numbering` | 起始标题级别；例如 `2` 从 Heading 2 作为编号第一级。不是编号数值。 |

## 固定样式对应关系

正文使用 `styles.normal`，Markdown H1–H6 使用 `styles.heading1`–`styles.heading6`，引用使用 `styles.quote`，代码使用 `styles.codeBlock`，图表题注使用 `styles.caption`，表格使用 `styles.table`。不提供自定义字段映射；旧 `elements` 在加载时清除。

新增配置字段前，必须先在本文加入消费状态、核心入口和测试方式，避免出现只有 UI 控件而没有转换效果的配置。

页眉页脚、目录、分节、预览、图片策略和 Mermaid 策略当前不属于正式配置字段；Mermaid 内容由预检固定产生不支持警告。
