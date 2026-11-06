# WSL / Linux Conda 开发环境

建立日期：2026-11-05。项目从 GitHub 克隆至 `~/md2docx`，基线提交 `1017146`。
本目录记录环境，不修改产品行为。后续是否提交这些文件由用户决定。

## 环境来源与差异

- Windows 来源：Conda `tools`（实际名称不是 tool），Python 3.14.10，pip 26.2.2。
- 原始 Python 包快照：`env/windows-tools.freeze.txt`，只供参考。
- WSL 目标：Conda `md2docx`，Python 3.14.7，pip 26.2.2。
- Windows 的精确 Python 3.14.10 在本次 Linux defaults 源中不可用；使用同系列、现有 Linux 缓存中可用的 3.14.7，已写入 environment.yml。
- `env/requirements.txt` 固定 Windows tools 中相应 Python 包版本。
- pefile 和 pywin32-ctypes 使用 Windows 平台标记，在 Linux 不安装。
- Windows 的本地包引用 `file:///D:/FileConversion` 改为 `-e .`，指向当前仓库。
- PyInstaller 是沿用 tools 的开发/打包依赖，不代表服务器转换必须使用它。
- Pandoc 使用 3.12.1 的 Linux x86_64 官方二进制，与 Windows 版本一致。

## 首次搭建

前提：Linux x86_64、已安装 Miniconda、git、bash、curl、tar、sha256sum、install。
脚本不会安装系统服务、配置端口或要求 sudo，也不是完整的生产部署脚本。

```bash
cd ~/md2docx
bash env/setup-wsl.sh
```

默认 Conda 可执行文件为 `~/miniconda3/bin/conda`。其他位置显式指定：

```bash
MD2DOCX_CONDA_EXE=/path/to/conda bash env/setup-wsl.sh
```

脚本按顺序创建/检查环境、安装固定 pip 与构建工具、安装 requirements、下载校验 Pandoc、执行 pip check 和 CLI doctor。
默认 pip 索引为清华 HTTPS 镜像；Conda 仍使用 environment.yml 中的 defaults 源。
安装项目时使用已固定的构建工具和 --no-build-isolation，避免隔离构建额外拉取不受控的最新版。
环境已存在时不会删除或重建，也不会更新其他 Conda 环境。现有同名环境必须使用 Python 3.14 系列。
首次需要访问 Conda 源、配置的 PyPI 镜像和 GitHub。若依赖版本无法获得，脚本失败，不静默改装最新版。
可通过 MD2DOCX_PIP_INDEX_URL 指定其他受信任的 HTTPS 索引；不修改全局 pip 配置，不关闭证书校验。
本地 env/verification/wheels 若存在，会作为候选 wheel 缓存参与安装，但不会进入 Git。

Pandoc 安装到目标环境的 `bin/pandoc`，不复制 Windows EXE，不修改系统 `/usr/bin`。
安装脚本固定官方发布资产的 SHA-256，再解压；下载期间的临时目录退出时清理。

## 日常使用

```bash
source ~/miniconda3/etc/profile.d/conda.sh
conda activate md2docx
cd ~/md2docx
python --version
python -m pip check
python cli/md2docx.py doctor --json
```

真实转换冒烟验证（输出放入被忽略的 `env/verification/`）：

```bash
python env/verify-environment.py
```

非交互式从 Windows 调用，不依赖 bashrc 自动激活：

```powershell
wsl.exe -d Ubuntu-26.04 --cd /home/zuoyx/md2docx -- /home/zuoyx/miniconda3/bin/conda run --no-capture-output -n md2docx python cli/md2docx.py doctor --json
```


## 镜像与代理

默认使用镜像：

```bash
bash env/setup-wsl.sh
```

临时换回官方索引：

```bash
MD2DOCX_PIP_INDEX_URL=https://pypi.org/simple bash env/setup-wsl.sh
```

如果需要通过 HTTP 代理访问，先确认该地址能从 WSL 访问，再在当前 shell 中设置 http_proxy/https_proxy；不要把凭据写进仓库。
当前 WSL 为 NAT，WSL 内 127.0.0.1:10808 的测试失败，而 Windows 本机同端口的 HTTP 代理测试成功。
因此不能直接把 Windows 的 127.0.0.1 代理配置搬入 WSL。此次镜像已可用，没有修改 WSL 网络模式、Windows 防火墙或代理监听配置。
Windows 的 `set` 是 cmd 语法；Bash 需要 `export` 或命令前的临时环境变量赋值。

## 文件说明

| 文件 | 用途 |
| --- | --- |
| environment.yml | Conda 名称、Python 版本、基础 pip |
| requirements.txt | 固定开发依赖及本项目 editable 安装 |
| windows-tools.freeze.txt | Windows 原始 pip 包清单，禁止直接用于 Linux |
| setup-wsl.sh | 重复执行环境搭建流程 |
| install-pandoc.sh | 固定版本、校验摘要的 Linux Pandoc 安装 |
| verify-environment.py | 中文路径、图片、表格、公式的最小转换验证 |
| *.resolved.txt / *.resolved.yml | 本地实际环境导出，忽略提交 |
| verification/ | 验证输入、结果、日志与安装记录，忽略提交 |

## 边界

- 此次只搭建 Python 转换与开发工具环境，没有安装 Node/Electron 前端依赖。
- 没有创建云端 HTTP API、Skill、数据库或公开服务。
- Linux 与 Windows Python 补丁版本不同，不能宣称逐字节相同的环境。
- `pip check`、doctor 和冒烟输出分别验证依赖、发现运行时、实际转换；不替代 Word/WPS 字体分页验收。
- 单个 bootstrap 脚本不等于可直接用于生产；生产部署仍需要身份、限额、隔离、持久任务、清理和运维配置。

## 本次验证结果（2026-11-05）

- Conda 环境名称：md2docx，目录 ~/miniconda3/envs/md2docx。
- Python 3.14.7，pip 26.2.2，python-docx 1.2.0，lxml 6.1.3，PyInstaller 6.22.3，Pandoc 3.12.1。
- 使用清华 HTTPS 镜像安装成功；脚本重复执行成功。
- pip check：No broken requirements found。
- CLI doctor：Python、Pandoc、python-docx、lxml 全部 available=true，success=true。
- 真实转换：中文及空格路径、中文正文与标题、表格、PNG、OMML 公式、代码围栏均生成成功，warnings=[]。
- 输出结构统计：9 段落、1 表格、1 图片、1 OMML 对象；解析 DOCX XML 后确认保留标题年份和中文正文。
- 验证产物在 env/verification/；本地实际依赖导出为 env/pip.resolved.txt、env/conda.resolved.yml。
- 未执行 Word/WPS 最终视觉排版检查，没有修改产品代码，没有提交或推送 Git。
