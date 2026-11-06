# 云端 HTTP API（当前实现）

前缀 `/v1`，OpenAPI 3.1 位于 `/openapi.json`。这是已实现的服务接口，早期 planning 草案中的账户/API Key 设计不再适用。
产品免费、免登录。用户无需安装 Python/Pandoc；Agent 只需 HTTP 和文件下载能力。

## 1. 临时会话

网页使用 HttpOnly、SameSite=Strict Cookie；Agent 使用 `Authorization: Bearer <临时accessToken>`。
Token 由服务自动生成，不需要用户注册、申请或付费。服务端只保存 token 的 SHA-256。
默认有效期 48 小时，提交任务会延长服务端访问期，并刷新浏览器 Cookie。

### POST /v1/sessions

无请求体，返回 201：

```json
{
  "success": true,
  "data": {
    "accessToken": "<自动生成的临时凭证>",
    "expiresAt": "2026-11-07T00:00:00Z",
    "type": "temporary-session"
  },
  "requestId": "req_example"
}
```

浏览器自动保存 Cookie；Agent 在本次工作流中保存 accessToken。
无会话直接 POST /v1/jobs 也会自动创建会话，返回 data.session 并设置 Cookie。
为了幂等与网络中断恢复，Agent 建议先创建会话，再提交任务。

会话 token 不放 URL，不写日志、不提交 Git。没有会话就无法恢复自己任务的访问；新建会话不能取得旧会话的任务。

## 2. 通用返回

JSON 成功：`{success:true,data,requestId}`。
JSON 失败：`{success:false,error:{code,message,fields,retryable},requestId}`。
下载为二进制；DELETE 成功返回 204 空响应。

GET 查询成功的 success=true 只表示查询成功。判断转换结果应读取 data.status 和 data.items。
所有日期是 UTC RFC 3339；响应头有 X-Request-ID、禁止共享缓存和 nosniff。

## 3. 服务与配置接口

| 方法/路径 | 用途 |
| --- | --- |
| GET /healthz | API 进程响应 |
| GET /readyz | 隔离环境就绪为 200；不可用为 503 |
| GET /v1/capabilities | 输入模式、配置版本、预设、实际限制 |
| GET /v1/config/schema | 服务端严格样式 JSON Schema |
| POST /v1/config/validate | 校验/补齐配置，返回 effective config、摘要和警告 |

配置校验请求：

```json
{"config":{"preset":"default"}}
```

或：

```json
{
  "config": {
    "profile": {
      "schemaVersion": 2,
      "id": "report",
      "numbering": {"enabled": false, "stripExisting": false},
      "styles": {"normal": {"eastAsia":"宋体","ascii":"Times New Roman","sizePt":12}}
    }
  }
}
```

preset/profile 恰好提供一个。只提供 schemaVersion 的 profile 会从现有核心默认值补齐。
支持全部现有核心样式分组，但比 CLI 更严格：未知/废弃字段、非法颜色、零字号和页边距超过正文区域会拒绝。
页面 preset 仍沿用核心语义：显式宽高是最终尺寸；仅改 preset 不保证宽高随之变化。

`numbering.stripExisting=true` 沿用既有清理行为，可能删除标题年份等数字，返回 HEADING_NUMBER_REMOVAL_ENABLED 警告。
需要原文数字保真时显式使用 false；关闭 enabled 不自动关闭 stripExisting。此处没有静默修复核心协议。

## 4. 创建任务

### POST /v1/jobs — JSON

```json
{
  "documents": [
    {"id":"doc-1","path":"报告.md","content":"# 标题\n\n正文"}
  ],
  "config": {
    "profile": {
      "schemaVersion":2,
      "numbering":{"enabled":false,"stripExisting":false}
    }
  },
  "execution": {"missingImages":"warning","batchErrors":"continue"}
}
```

- documents 非空；id 为 1—64 位 ASCII 字母/数字/下划线/短横线且唯一。
- path 为任务内相对路径，后缀 .md/.markdown。不会读取客户端或服务器绝对路径。
- content 为 UTF-8 文本。JSON 模式不支持资源附件或 part。
- config 可省略，使用 default 预设；execution 可省略，默认如上。
- 批量共用一份样式配置，继续/停止策略沿用 CLI。

### POST /v1/jobs — multipart/form-data

request 文本字段存清单；文件字段与清单 part 一一对应：

```json
{
  "documents": [
    {"id":"one","path":"reports/a.md","part":"markdown1"},
    {"id":"two","path":"other/a.md","part":"markdown2"}
  ],
  "resources": [{"path":"reports/images/chart.png","part":"image1"}],
  "config": {"profile":{"schemaVersion":2,"numbering":{"stripExisting":false}}},
  "execution": {"missingImages":"stop","batchErrors":"continue"}
}
```

reports/a.md 可使用 `![图](images/chart.png)`。图片资源路径相对于各 Markdown 目录解析。
同名文档位于不同目录时可同时转换，内部文件名与输出标识保证唯一，下载名可以相同。

只接受声明过的文件 part，拒绝重复字段和重复路径（规范化后不区分大小写）。不能同时提供 content 和 part。
PNG/JPEG 按真实格式、像素数、帧数及解码总量检查，隔离环境内重编码并移除元数据。拒绝动画、ZIP、SVG 和其他资源格式。
路径不接受绝对路径、盘符、反斜线、控制字符、空段、`.` 或 `..`。

网络资源不会在沙箱里联网抓取；本地图片缺失时按 missingImages=warning/stop 处理。

### 创建响应

接受前已保存输入、有效配置和任务记录；返回 202、Location 和 Retry-After。

```json
{
  "success": true,
  "data": {
    "jobId":"job_example",
    "status":"queued",
    "createdAt":"2026-11-05T00:00:00Z",
    "startedAt":null,
    "finishedAt":null,
    "expiresAt":null,
    "engine":{"coreVersion":"0.2.0","buildId":"sha256:<源码摘要>"},
    "config":{"schemaVersion":2,"digest":"sha256:<有效配置摘要>"},
    "items":[{
      "documentId":"doc-1","path":"报告.md","status":"pending","stage":null,
      "warnings":[],"error":null,"artifact":null
    }],
    "error":null,
    "summary":{"total":1,"succeeded":0,"failed":0,"skipped":0,"pending":1,"running":0,"unprocessed":0}
  },
  "requestId":"req_example"
}
```

样例摘要/ID 均为占位。无会话首次提交还会有 data.session，结构与会话端点相同。

### 幂等

提供 `Idempotency-Key`，值为 16—128 位字母、数字、下划线、短横线。
使用幂等必须先创建临时会话；幂等范围是会话＋键。
相同键和相同语义输入返回同一 jobId；不同内容返回 409。任务删除/过期后，保留墓碑期间返回 410，不偷偷重新创建。
网络重试使用原键；用户主动重新转换使用新键。文件字节摘要、逻辑路径、配置选择和任务选项参与指纹，multipart boundary 不参与。

## 5. 查询、取消、删除

### GET /v1/jobs/{jobId}

要求任务所属会话。不存在或其他会话的任务统一 404；已过期/删除的本会话任务返回 410。

任务状态：queued、running、cancelling；终态 succeeded、partially_succeeded、failed、cancelled、timed_out。
逐文件状态：pending、running、succeeded、failed、skipped、unprocessed。

```text
total = succeeded + failed + skipped + pending + running + unprocessed
终态时 pending = running = 0
```

- 全部成功为 succeeded；警告不算失败。
- 有成功且其他项失败/未处理为 partially_succeeded；没有成功产物则 failed。
- 用户取消或任务总超时使用 cancelled/timed_out，可继续下载此前已成功项。
- batchErrors=stop 时先记录失败项，剩余项标 unprocessed。
- stage 是阶段提示，不代表等比例进度。包括 queued、preflight、pandoc、postprocess、validate、write-output 等。
- 单项错误提供稳定 code、简短 message、documentId、retryable，不提供主机路径和原始 stderr。
- 对象统计沿用核心：paragraphs、tables、images、omml，不是页数，也不是完整内容正确性证明。

成功项的 artifact：

```json
{
  "id":"art_example",
  "filename":"报告.docx",
  "sizeBytes":11000,
  "sha256":"<真实SHA-256>"
}
```

### POST /v1/jobs/{jobId}/cancel

无请求体。排队任务可以直接 cancelled；运行任务返回 202/cancelling，直到进程树停止后进入终态。
重复取消幂等，终态不改写。关闭网页或停止轮询不会自动取消。

### DELETE /v1/jobs/{jobId}

仅终态任务允许删除，成功 204。运行中返回 409，先取消并等待停止。
文件清理失败返回 503，不提前宣称删除完成。保留不含正文的幂等墓碑，用于拒绝旧请求重放。

## 6. 下载

`GET /v1/jobs/{jobId}/artifacts/{artifactId}`，携带同一会话。
返回标准 DOCX MIME、Content-Length、Content-Disposition 和禁止共享缓存的头。
中文下载名使用 filename* 编码，实际输出目录不公开。客户端下载后核对 sizeBytes 和 sha256，再将临时文件改为最终文件。

输出正常保留 24 小时，可主动删除。不要把任务已受理或云端成功误报为本地文件已完整下载。
当前不提供默认公开链接、永久链接、ZIP 批量包或 webhook。

## 7. 错误与重试

| HTTP | 主要情况 |
| --- | --- |
| 400 | 非法 JSON/multipart、上传中断、无会话的幂等提交 |
| 401 | 临时会话缺失/失效 |
| 403 | 网页 Origin 不允许 |
| 404 | 不存在或无权访问 |
| 408 | 上传超时 |
| 409 | 幂等冲突、运行中删除 |
| 410 | 本会话任务已过期/删除 |
| 413 | 上传、图片解码大小或数量超限 |
| 415 | 请求媒体类型不支持 |
| 422 | 文档路径、配置字段、图片或清单语义不合法 |
| 429 | IP 频率、上传/下载并发或会话活跃任务限制 |
| 500 | 未归类内部错误，公网不提供堆栈 |
| 503 | 队列/存储/会话容量满、沙箱未就绪 |

可重试错误提供 Retry-After。使用有限退避；配置、格式、权限错误应先修正。
错误 code 与 HTTP 状态都应保留，不解析自然语言 message 做业务分支。
HTTP retryable 与 CLI recoverable 含义不同，不直接互相改名。

## 8. 快速调用

浏览器在 HTTPS 同源环境可使用 credentials: include，Cookie 自动管理。跨域需配置具体 MD2DOCX_ORIGINS。

Agent 可用标准 HTTP 客户端，示例 Python 仅依赖标准库，不依赖转换环境：

```python
import json
import time
import urllib.request

base = "http://127.0.0.1:8000"

def call(path, data=None, token=None):
    headers = {"Content-Type":"application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)["data"]

token = call("/v1/sessions", {})["accessToken"]
job = call("/v1/jobs", {
    "documents":[{"id":"one","path":"report.md","content":"# 报告\n\n正文"}],
    "config":{"profile":{"schemaVersion":2,"numbering":{"stripExisting":False}}}
}, token)
while job["status"] in {"queued","running","cancelling"}:
    time.sleep(1)
    job = call("/v1/jobs/" + job["jobId"], token=token)
if job["status"] != "succeeded":
    raise RuntimeError(job)
artifact = job["items"][0]["artifact"]
url = base + "/v1/jobs/" + job["jobId"] + "/artifacts/" + artifact["id"]
req = urllib.request.Request(url, headers={"Authorization":"Bearer " + token})
with urllib.request.urlopen(req, timeout=30) as response:
    result = response.read()
import hashlib
assert len(result) == artifact["sizeBytes"]
assert hashlib.sha256(result).hexdigest() == artifact["sha256"]
with open("report.docx", "xb") as output:
    output.write(result)
```

这是最小接口示例；正式 Skill 还应处理有限等待、幂等重试、部分成功、下载中断及用户指定目标目录。
