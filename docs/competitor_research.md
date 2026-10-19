# Markdown→DOCX 竞品与开源项目调研（2026-10-04）

## 事实样本

对 GitHub API 查询结果（查询日 2026-10-04）:

| 项目 | Stars | License | 最近更新 | 关键定位 |
|---|---:|---|---|---|
| [jgm/pandoc](https://github.com/jgm/pandoc) | 46.5k | GPL-2.0 | 2026-10-04 | 通用标记转换器，Markdown/GFM→DOCX |
| [quarto-dev/quarto-cli](https://github.com/quarto-dev/quarto-cli) | 6.1k | MIT（仓库 COPYING） | 2026-10-04 | 基于 Pandoc 的技术出版系统 |
| [marktext/marktext](https://github.com/marktext/marktext) | 62.1k | MIT | 2026-10-04 | Electron Markdown 编辑器 |
| [shd101wyy/markdown-preview-enhanced](https://github.com/shd101wyy/markdown-preview-enhanced) | 4.4k | 需核对仓库 LICENSE | 2026-10-02 | Atom/VS Code Markdown 预览扩展，支持 Pandoc 导出路径 |
| [dolanmiu/docx](https://github.com/dolanmiu/docx) | 5.9k | MIT | 2026-10-04 | JS/TS 声明式 DOCX 生成/修改 |
| [python-openxml/python-docx](https://github.com/python-openxml/python-docx) | 5.7k | MIT | 2026-10-03 | Python DOCX 生成/修改 |
| [deepseek-ai/dsh-libreoffice-kit](https://github.com/deepseek-ai/dsh-libreoffice-kit) | 135 | MPL-2.0 | 2026-10-04 | 预编译 LibreOffice 引擎，Node 离线 Office→PDF/PNG 渲染 |
| [pandoc-ext/diagram](https://github.com/pandoc-ext/diagram) | 227 | MIT | 2026-09-22 | Pandoc Lua filter，Mermaid/Graphviz/PlantUML 等图形转图片/内嵌资源 |

Stars/更新时间会变化；上表用于规模和活跃度参考，不是长期保证。

## 项目与需求匹配

### Pandoc（最重要的转换核心候选）

- CLI/API成熟、批处理快，原生支持 `markdown`, `commonmark`, `gfm` 输入及 `docx` 输出；图片嵌入 DOCX，表格写成 Word 原生表格，代码块、引用、列表、脚注、链接有现成映射。
- DOCX 使用 Word 样式体系：可用 `--reference-doc=模板.docx` 预置 Normal、Heading 1–6、Quote、Source Code、表格等样式；Lua filter 可在 AST 层增删改节点；`--resource-path` 解决图片相对路径。
- Pandoc DOCX writer 通常把 TeX 数学转为 Word OMML（需针对 `$...$`/`$$...$$`、`	ag`、宏命令做测试）；不支持或复杂宏应捕获 warning、保留原文/图片降级。
- 许可证 GPL-2.0。将 Pandoc 作为独立可执行程序调用，开源桌面应用可以分发，但若链接/改写其 GPL 代码需遵守 GPL；建议保持进程边界、随包提供许可证和源码获取说明。Lua filters 可采用 MIT/自有许可。
- 不足：默认转换虽准确，但细粒度字体、段前段后、中文首行缩进、三线表、自动编号、分页等需 reference.docx、Lua filter 或后处理；没有漂亮的 Windows GUI；错误诊断需封装 stderr/退出码。

### Quarto

- MIT 主仓库，基于 Pandoc 的 CLI 技术出版工具；YAML 项目配置、交叉引用、目录、公式、图表、执行代码等比纯 Pandoc 更完整。
- 适合研究/可复现出版，不是面向普通用户的 DOCX 转换 GUI；引入 R/Python/Jupyter 生态可能显著增加安装体积和复杂度。对本项目可借鉴 YAML 配置、过滤器和交叉引用，不建议作为第一版运行时依赖。

### Typora

- 闭源商业桌面编辑器（Windows/macOS/Linux），不是可纳入开源软件栈的 GitHub 源码项目。
- Markdown 编辑体验和预览优秀，能导出 DOCX/PDF/HTML；但导出样式可控性、批量/API、LLM 自动化和逐段临时样式能力有限，无法作为本项目核心。可作为界面交互标杆。

### MarkText

- MIT 开源 Electron 编辑器，Windows 可用，实时所见即所得体验好。
- 主要导出 HTML/PDF 等；DOCX 通常需外部 Pandoc/插件或用户手工流程，缺少“真正 Word 样式可配置 + 批量 DOCX”产品闭环。可借鉴 Markdown 编辑和主题实现，但不宜直接 fork 后当转换核心。

### Obsidian

- 闭源商业/免费个人使用笔记软件，插件生态丰富；本体没有强 DOCX 原生导出闭环，常见方案是 Pandoc 插件或 HTML/PDF 中转。
- 适合知识库，不适合本需求的独立 Windows 转换器、可控字体样式和批量输出；插件 API 可借鉴自动化设计。

### Markdown Preview Enhanced

- 编辑器扩展，支持丰富 Markdown（公式、图、流程图）预览，并可调用 Pandoc 导出；能作为预览/渲染参考。
- 依赖 Atom/VS Code 运行环境，样式和转换配置分散，不提供独立的 Word 样式管理与 Windows 打包体验。

### `docx`（dolanmiu）与 `python-docx`

- MIT、活跃，分别适合 Node/TS 与 Python 的低级 DOCX 生成/修改；能精确设置字体、段落、边框、表格、图片，亦可直接写 OOXML。
- 不能单独解析完整 Markdown，也不负责 LaTeX→OMML、GFM 容错、资源解析；适合作为 Pandoc 后处理或独立 AST→DOCX 渲染器，而非唯一引擎。
- 若选 Electron/Tauri + Node，`docx` 方便实现样式编辑器，但需自行维护 Markdown AST、公式和编号；Pandoc + 后处理一般更快达到准确率目标。

### dsh-libreoffice-kit（用户提供的项目）

- README 明确：MPL-2.0，Node.js 22.19+，0.1.x；提供预编译 LibreOffice 原生/WASM 引擎、Office→PDF、Office/PDF→PNG、字体发现/替换与 `missingFonts` 诊断，Windows x64 有对应 native package。
- 可内置离线预览，避免要求用户安装 LibreOffice；API 由应用管理临时目录、权限和 UI。`render` 每次使用独立进程/worker，同一 converter 串行；输出路径须绝对且不能已存在。
- 不是 Markdown→DOCX 引擎，不能替代 Pandoc/`docx`；它应位于“DOCX 生成后预览”层。字体需用户环境提供，不能保证与 Word 分页完全一致；引擎包体积仍较大，需遵守 MPL-2.0 与 LibreOffice/第三方许可材料。Node 版本要求（22.19+）影响 Electron 打包和运行时选择。
- 对本项目价值：V1 可作为可选预览服务；核心转换失败不应依赖它。Windows x64 离线打包需在安装体积、字体版权和启动时间上评估。

## 市面产品结论

目前没有发现同时满足“Windows 开源 GUI + Markdown/GFM 容错 + 真实 Word Heading/Normal 样式 + 可配置中文字体/段落 + 批量转换 + OMML + 原生图片/表格 + 单段预览覆盖”的成熟单一产品。最接近的是：Pandoc（转换正确性/可编程）+ 自研 GUI/配置层 + 可选 LibreOffice 渲染（预览）。Typora/MarkText解决编辑体验，不能解决可编程批量和样式闭环。

## 推荐技术组合

1. 转换核心：独立 Pandoc 进程（`--from=gfm+tex_math_dollars+raw_html` 或按配置），Lua filter 负责标题/编号、警告、图片路径、代码块和降级；`--reference-doc` 由 UI 生成/维护。
2. 样式：把用户设置映射到 reference.docx 的 `w:style`（Heading 1–6、Normal、Quote、Code Block、Table）；必要时用 OOXML 后处理修正中文东亚字体、首行缩进和三线表。避免仅改 Run，优先改 Paragraph Style。
3. 预览：可选 dsh-libreoffice-kit `render` 输出 PDF/PNG；没有预览时仍完成 DOCX 导出。Word/WPS 是最终编辑器，不把 LibreOffice 排版当验收真值。
4. UI：Electron（React/Svelte）或 Tauri（Rust + Web UI）；若以 Node/Pandoc/dsh 集成为主，Electron 接入成本低；Tauri 体积小但需要 Rust sidecar/进程管理。第一版可先 Electron，核心 API 与 GUI 解耦以便未来迁移。

## 参考脚本/样例观察

用户 `export_new.py` 已验证一条可行流水线：预处理图注与 `\\tag{N}`，Pandoc+Lua 转 DOCX，`python-docx` 按章节状态机精修字体、中文字号、首行缩进、页面边距、三线表，最后 Word COM 导 PDF。该脚本对 56 KB、约 1030 行样例统计：1 个 H1、12 个 H2、24 个 H3、12 图片、约 57 表格行、289 个行内公式、74 个块公式、2 个 fenced code 行。它说明转换核心可行，但状态机/文本正则与 Word COM 耦合严重；产品化应改为结构化 AST + reference.docx/OOXML，PDF 预览改为可选 LibreOffice 组件。

## 许可与分发提示

- Pandoc GPL-2.0：建议独立 sidecar/子进程调用，随发行包附 GPL 文本、版权和源码取得方式；不要把其源代码静态链接进闭源组件（本项目计划开源，风险较低但仍应合规）。
- Quarto/MarkText/docx/python-docx/diagram 多为 MIT；dsh-libreoffice-kit 为 MPL-2.0，需保留修改文件的 MPL 通知；LibreOffice 及其依赖还要随包带完整第三方许可清单。
- Mermaid/KaTeX/MathJax、字体文件和图标另行核对许可证；不默认捆绑商用字体（宋体/黑体/微软雅黑）以规避再分发风险，运行时使用用户已安装字体或配置开源替代字体。
