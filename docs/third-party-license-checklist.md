# 第三方许可证准备清单

以下清单用于 `0.2.0` 发布准备，不构成法律意见。最终发布前应从实际制品重新生成依赖清单并核对许可证原文。

## 必须随发布目录提供

| 组件 | 当前版本 | 常见许可证 | 需要准备的材料 |
| --- | --- | --- | --- |
| Pandoc | 3.12.1 | GPL-2.0-or-later | 已有 `COPYRIGHT.txt`、`COPYING.rtf`；保留源码版本链接及对应源码获取方式 |
| Electron | 44.5.1 | MIT，且包含 Chromium/Node 等第三方许可 | Electron `LICENSE`、`LICENSES.chromium.html`，以及 Electron 分发包自带的许可文件 |
| Python | 3.14.x（以最终 CLI 制品为准） | PSF License | Python LICENSE、版权声明 |
| python-docx | 1.2.0 | MIT | 包内 LICENSE |
| lxml | 6.1.3 | BSD-3-Clause | 包内 LICENSES/许可证目录，包含 libxml2/libxslt 相关声明 |
| typing_extensions | 4.16.0 | PSF-2.0 | 包内 LICENSE |
| React | 19.3.0 | MIT | LICENSE |
| React DOM | 19.3.0 | MIT | LICENSE |

## 构建工具

这些工具通常不直接进入最终运行目录，但应保留构建记录：

| 组件 | 当前版本或约束 | 常见许可证 |
| --- | --- | --- |
| Vite | 8.3.2 | MIT |
| @vitejs/plugin-react | 6.1.1 | MIT |
| PyInstaller | `>=6.16` | GPL-2.0-or-later，Bootloader 带分发例外 |
| setuptools | `>=68` | MIT |

## 建议目录

```text
release/<edition>/licenses/
├─ PANDOC-COPYING.rtf
├─ ELECTRON-LICENSE
├─ CHROMIUM-LICENSES.html
├─ PYTHON-LICENSE.txt
├─ PYTHON-DOCX-LICENSE.txt
├─ LXML-LICENSES/
├─ TYPING-EXTENSIONS-LICENSE.txt
├─ REACT-LICENSE.txt
└─ THIRD-PARTY-NOTICES.txt
```

## 发布前核对

1. 以最终发布目录中的实际二进制和包版本为准，不只看开发环境。
2. 不要删除 Electron 自带的 `LICENSE` 与 `LICENSES.chromium.html`。
3. Pandoc 的 GPL 义务需要单独确认，尤其是对应源码的可获得性。
4. 将所有组件、版本、许可证和项目网址汇总到 `THIRD-PARTY-NOTICES.txt`。
5. CLI 版与桌面版分别检查，因为桌面版额外包含 Electron、Chromium、Node、React。
