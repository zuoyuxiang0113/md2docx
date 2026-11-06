# MD2DOCX 服务器端

在 Linux/WSL 上为现有转换核心增加 HTTP 接口。**免费、免登录，不申请长期 API Key。**
代码集中在 `server/`，没有修改 `core/`、`cli/` 或桌面前端。

## 已实现

- JSON Markdown 文本和 multipart Markdown/图片上传。
- 单文件和批量任务；复用已有页面、字体、正文、六级标题、表格、引用、代码、图片、题注、公式及编号配置。
- 运行既有 CLI，输出仍由 Pandoc + python-docx/OOXML 生成。
- 持久 SQLite 队列、顺序执行、阶段查询、逐项结果、批量继续/停止、运行中取消。
- DOCX 鉴权下载、大小与 SHA-256、主动删除、24 小时结果过期清理。
- 自动临时会话，支持浏览器 HttpOnly Cookie 或 Agent Bearer token。
- 配置归一化/严格校验、OpenAPI 3.1、配置 JSON Schema。
- Bubblewrap 无网络/文件系统隔离，超时、输出、进程与存储限额。

网页和 Agent 使用的是同一套接口。临时会话不需要注册，不是收费或人工发放的 API Key；它防止其他调用者访问你的任务。

## WSL 启动

在项目根目录执行：

```bash
conda activate md2docx
bash server/scripts/bootstrap.sh
MD2DOCX_COOKIE_SECURE=0 bash server/scripts/run.sh --docs
```

本机入口：`http://127.0.0.1:8000`；交互文档：`/docs`；OpenAPI：`/openapi.json`。
开发时显式 `COOKIE_SECURE=0` 便于本机 HTTP Cookie；HTTPS 部署保留默认 `1`。

也可直接：

```bash
python -m server --host 127.0.0.1 --port 8000 --docs
```

只运行一个 API worker。不要加 Uvicorn 多 worker；同一数据目录有进程锁，第二个实例会拒绝启动。
默认不暴露局域网、不配置防火墙、不使用来自公网的转发头推断 IP，也不启动 WebSocket。

## 环境与迁移

`bootstrap.sh` 不依赖被忽略的 `env/` 目录：拉取 GitHub 后，只需仓库源码、Linux Miniconda 和系统 Bubblewrap。

```bash
# Ubuntu 系统前提，由管理员准备：
sudo apt-get update
sudo apt-get install bubblewrap ca-certificates curl

# 以普通用户，在仓库根目录运行：
bash server/scripts/bootstrap.sh
```

- 当前脚本支持 Linux x86_64；服务器实际架构尚未确认，不承诺 ARM 可直接运行。
- 缺 Conda 或 Bubblewrap 时给出错误，不静默降级成未隔离的转换。
- 如环境不存在，创建 Conda `md2docx`，Python 3.14.7。
- `requirements-lock.txt` 固定运行依赖，保留核心 python-docx 1.2.0、lxml 6.1.3。
- Pandoc 安装到该 Conda 环境；官方 3.12.1 Linux 包经过固定 SHA-256 校验。
- 默认使用清华 HTTPS pip 镜像；可设置 `MD2DOCX_PIP_INDEX_URL`、`MD2DOCX_CONDA_EXE`、`MD2DOCX_SERVER_PYTHON`。
- 不关闭 TLS 校验，不把代理地址或凭据写入仓库。
- 不会自动执行 Git pull、覆盖已有部署、启用系统服务或公开端口；先验证再切换版本。

依赖更新后，可在当前环境明确执行 `python server/scripts/lock-dependencies.py` 重新导出锁定清单；不要在每次部署时重锁。

## 使用 API

详见 [API.md](API.md)。最小流程：

1. `POST /v1/sessions` 自动获取免费临时会话，或首次创建任务时自动生成。
2. `POST /v1/jobs` 提交正文或 multipart 上传。
3. `GET /v1/jobs/{jobId}` 查询至终态。
4. `GET /v1/jobs/{jobId}/artifacts/{artifactId}` 下载成功项。
5. 根据需要取消或删除任务。

所有任务操作都需要同一会话；浏览器自动带 Cookie，Agent 自动带 Bearer token。不要丢失会话 token，也不要把它写入 URL、日志或提交到 Git。

## 运行配置

环境变量在进程启动时读取；示例见 `config.env.example`。相对 `MD2DOCX_DATA_DIR` 以启动工作目录为基准，生产建议绝对路径。

| 配置 | 默认值 |
| --- | --- |
| MD2DOCX_DATA_DIR | server/data |
| MD2DOCX_ORIGINS | http://localhost:8000,http://127.0.0.1:8000 |
| MD2DOCX_COOKIE_SECURE | 1 |
| MD2DOCX_MAX_REQUEST_BYTES | 20 MiB |
| MD2DOCX_MAX_MARKDOWN_BYTES | 2 MiB |
| MD2DOCX_MAX_DOCUMENTS / MAX_RESOURCES | 10 / 50 |
| MD2DOCX_MAX_IMAGE_BYTES / MAX_IMAGE_PIXELS | 5 MiB / 1600 万像素 |
| MD2DOCX_MAX_QUEUE | 8（包含运行中任务） |
| MD2DOCX_MAX_ACTIVE_PER_SESSION | 2 |
| MD2DOCX_FILE_TIMEOUT / JOB_TIMEOUT / QUEUE_TIMEOUT | 60 / 180 / 300 秒 |
| MD2DOCX_MAX_OUTPUT_BYTES | 每文件 20 MiB |
| MD2DOCX_MAX_STORAGE_BYTES | 512 MiB 业务存储预算 |
| MD2DOCX_MIN_FREE_BYTES | 256 MiB 磁盘保留空间 |
| MD2DOCX_RETENTION_SECONDS | 86400，结果保留 24 小时 |
| MD2DOCX_SESSION_SECONDS | 172800，临时会话 48 小时；提交可延长 |

这些数值是可调整的保守初值，不是对 2 核 2G 服务器已经完成的容量承诺。一次处理一个文件。
工作进程会在每份转换前预留输出预算；同时上传期间可出现有界的短暂预算波动，不是文件系统硬配额。

## 数据目录

```text
server/data/
├── state.sqlite3        # 会话 token 的 SHA-256、任务状态、幂等与短期限流记录
├── server.lock          # 单实例锁
├── staging/             # 接收完成后暂存，异常/重启清理
└── jobs/<jobId>/
    ├── inputs/          # 本任务上传的 Markdown/资源，终态后清理
    ├── config.json      # 本任务有效配置，终态后清理
    └── outputs/         # 只发布校验完成的 DOCX
```

任务终态后清理输入、配置、报告和临时文件；已完成 DOCX 保留至到期或主动删除。
到期先拒绝访问，周期清理约每 10 秒执行，重启时也清理。删除后的最小所有权/幂等墓碑保留约 24 小时，不含正文。
临时会话到期清理；token 只保存 SHA-256。下载流开始后已经读取的字节不能撤回；删除不保证中断已经授权并打开的下载。

## 公网部署的安全边界

详见 [SECURITY.md](SECURITY.md)。所有服务器功能不能代替入口层的 TLS、连接/带宽保护。

- 建议用专用普通 Linux 用户部署，管理员用户不应直接运行公网服务。
- API 默认只监听 loopback；按实际选择 Cloudflare Tunnel 或反向代理，不自动放行端口。
- Bubblewrap 依赖内核和系统策略支持用户命名空间；`python -m server.check` 失败时转换入口拒绝服务。
- 转换仅映射本任务目录、核心/CLI 代码、Conda 运行时及只读系统库；不映射服务数据目录或用户主目录。
- 建议生产启用附带的 systemd 总资源约束。进程自身的 RLIMIT 不是整台服务的总内存配额。
- 生产必须设置准确的允许 Origin、HTTPS Cookie。前端开发地址如 5173 需显式加入 Origins。
- 当前不信任 X-Forwarded-For/CF-Connecting-IP，代理后限流会将共享出口视为同一 IP。公网接入时要结合受信任代理边界处理，不直接相信客户端自报 IP。

systemd 模板和生成器只生成可审查文件，不自动安装：

```bash
python server/scripts/render-service.py \
  --data-dir "$HOME/.local/share/md2docx-server" \
  --output server/data/md2docx.service
```

生成前检查专用用户、路径和资源值；再由管理员审查并安装。模板提供总内存 768 MiB、CPU 100%、TasksMax 128 等初值，真实服务器需实测确认。
模板针对宿主机 Conda + Bubblewrap 方式，不能直接作为 Docker 内套用的通用模板。

## 验证

```bash
python -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple -r server/requirements-dev.txt
python -m pytest server/tests -q
python -m server.check
python -m pip check
```

集成测试真实调用现有 Pandoc/核心，并验证图片、中文、表格、公式、任务访问隔离、路径/配置/上传限制、队列恢复、取消、超时及子进程清理。
需要 Linux Bubblewrap；不以假执行器替代全部转换测试。未进行 Word/WPS 最终分页验收、外网攻防测试或真实 2 核 2G 压测。

## 与现有产品的边界

- 这里实现服务器，不包含新版网页 UI、正式 Skill 分发或账户/支付系统。
- 复用全部现有样式字段；公网图片上传先限制 PNG/JPEG，拒绝坏图/动画/像素超限，网络资源不在沙箱中联网读取。
- 已有标题数字清理仍是核心原有行为。服务不会静默修改默认协议；启用 stripExisting 时返回明确警告。保留年份等数字请显式设 false。
- 页眉页脚、目录、Mermaid 图像渲染等核心未实现能力，没有因加 HTTP 层而新增。
- 配置比 CLI 更严格：拒绝未知字段、非法颜色/字号和无正文空间的页边距。
- 核心协议、桌面导航和本地用户数据没有改动。

## 本次验收记录（2026-11-05）

- 31 项集成/安全回归通过；真实转换使用当前 Conda 与 Pandoc，并非全部模拟。
- bootstrap.sh 重复执行通过；pip check、CLI doctor、隔离环境检查均通过。
- OpenAPI 3.1.0 已导出到 openapi.json，10 个路径，所有本地 schema 引用已解析核对。
- 已从 Windows 经 localhost 完成创建会话、提交中文 Markdown、查询、下载、SHA-256 校验和删除；下载 DOCX 10696 字节。
- 本地服务默认测试监听 127.0.0.1:8000，未开放公网、未安装 systemd 服务、未修改防火墙或 DNS。
- core/cli/desktop 无源码差异；仓库原有 .gitignore 修改保留；server/ 文件尚未提交或推送。
- 测试框架目前有一条 httpx 兼容性弃用提示，不影响通过结果；生产运行不依赖测试客户端。
