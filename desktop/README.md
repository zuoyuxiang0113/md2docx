# MD2DOCX Desktop

Electron + React + Vite 是图形客户端。转换逻辑由项目根目录的 `cli/md2docx_cli.py` 和 `core/md2docx_core.py` 提供，Renderer 不直接执行 Python 或 Shell。

## 开发

```powershell
cd D:\FileConversion\desktop
npm install
npm run dev
```

开发服务端口默认是 `5173`，并从应用设置中的“服务端口”读取；`MD2DOCX_PORT` 环境变量可以临时覆盖保存值。

## 运行时发现

Python：`MD2DOCX_PYTHON`、`runtime/python/python.exe`、`py.exe`、`python.exe`。

Pandoc：`MD2DOCX_PANDOC`、`runtime/pandoc/pandoc.exe`、PATH 中的 `pandoc.exe`。

## 配置库

用户配置存放在 Electron 的 `app.getPath("userData")/profiles`。根目录 `profiles` 只保存开发阶段示例配置。

配置页面支持切换、保存、导入、导出、删除和打开配置目录。转换开始时，主进程会生成只读配置快照并通过 CLI 调用转换核心。

## 构建

```powershell
cd D:\FileConversion\desktop
npm run build
```
