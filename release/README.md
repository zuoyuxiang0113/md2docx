# 发布目录

`release` 只保存可分发制品，不保存用户配置、日志或转换结果。

```text
release/
├─ cli/md2docx/                 # 命令行目录版，入口 md2docx.exe
└─ desktop/MD2DOCX-portable/    # 桌面便携版，入口 MD2DOCX.exe
```

构建命令：

```powershell
./scripts/build-cli.ps1
./scripts/build-desktop-portable.ps1
```

两个版本都必须保留完整目录，不能只复制单个 EXE。正式安装器尚未生成；后续选定 electron-builder 或 Electron Forge 后放在 `release/desktop/installer/`。

发布时建议将 `md2docx.exe` 目录包和 `MD2DOCX-portable` 完整目录压缩后上传到 GitHub Release。源码仓库不应提交这些生成目录。
