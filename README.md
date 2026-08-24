# JLU GPA Calculator for Windows Desktop

面向吉林大学本科生的本地优先绩点核算桌面应用，可计算保研 GPA、加权平均分和算术平均分。

> 作者：Coldymemos · 共同作者：DailyPotato
> 当前版本：v1.0.1
> 非吉林大学官方系统，计算结果仅供个人核对，请以适用于本人的学院、专业和年份文件为准。

## 当前状态

桌面端以 Web 版 v1.0.1 为冻结基线独立演进。Tauri 2 桌面壳、Windows 构建、MSI/NSIS 打包和 CI 已完成；M2 已完成 SQLite 主存储、多档案管理、Web/桌面 JSON 迁移以及带 SHA-256 校验的数据库备份恢复；M3 已完成目录批量导入：目录选择与路径记忆、递归扫描、内容嗅探（不依赖文件名）、导入队列与逐文件报告、文件内容指纹去重、低置信度人工确认；M4 已完成解析增强：清洗管道（去括号批注、单位后缀、空白合并）、表头同义词与包含式自动映射、列映射确认界面、多规则集并行对照。

桌面运行时将课程、规则和设置按档案隔离保存在 `%APPDATA%\com.coldymemos.jlugpa.desktop\jlu-gpa-desktop.sqlite3`；单独运行 Web 构建时仍使用 IndexedDB。JSON 文件迁移当前档案，SQLite 备份/恢复整个数据库及全部档案。下一阶段进入 M5 文件系统进阶。

详细范围和施工顺序见：

- [本地化功能规划](本地化功能规划.md)
- [施工细节文档](施工细节文档.md)

## 已有功能

- 导入 `.xls`、`.xlsx`、`.csv`，支持多工作表选择、导入预览和逐行问题报告；
- 桌面端支持**目录批量导入**：递归扫描目录、按内容识别格式与表头（不依赖文件名）、内容重复文件自动去重、逐文件成败报告；
- 清洗管道自动处理 `90(重修)`、`90.0分`、全角字符、多余空白等脏数据；表头同义词自动匹配，无法识别的字段可手动指定列映射；
- **多规则集并行对照**：保存多套规则集，同一份课程数据按不同规则同时计算并排展示差异；
- 计算保研 GPA、加权平均分和算术平均分；
- 同课程号保留最高有效成绩，同名不同号不合并；
- 支持百分制、五级制和导入绩点/映射绩点切换；
- 手动新增、编辑、删除和排除课程；
- 为三项结果分别设置课程类型、关键词和课程号排除规则；
- 导出 PNG、PDF、课程明细和适配 Excel 表格；
- 完全离线运行，课程与设置保存在本机。

## 安装

在 GitHub Releases 下载 Windows 安装包：

- `*-setup.exe`：NSIS 安装程序；
- `*.msi`：Windows Installer 安装包。

当前发布目标为 Windows x64，依赖系统 WebView2。Windows 10/11 通常已预装 WebView2 Runtime。

## 本地开发

需要 Node.js 22、pnpm 11、Rust stable、Visual Studio 2022 C++ 构建工具和 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

常用命令：

| 命令                      | 说明                                          |
| ------------------------- | --------------------------------------------- |
| `pnpm tauri dev`          | 启动桌面开发环境                              |
| `pnpm tauri build`        | 生成 Windows 应用、MSI 和 NSIS 安装包         |
| `pnpm check`              | lint、格式检查、测试、类型检查和 Web 基线构建 |
| `pnpm test`               | 运行 Vitest 单元与组件测试                    |
| `pnpm test:e2e`           | 运行 Playwright 端到端测试                    |
| `pnpm dev` / `pnpm build` | 单独启动或构建 Web 基线，用于验证双端兼容     |

## 项目结构

```text
src/
├── domain/           # 纯计算引擎、课程模型与规则
├── application/      # 导入、合并等应用用例
├── infrastructure/   # 导入导出和持久化适配器
└── ui/               # React 界面与状态
src-tauri/
├── src/              # Rust 桌面后端
├── capabilities/     # Tauri 最小权限配置
└── tauri.conf.json   # 窗口、构建与安装包配置
```

`src/domain/` 是与 Web v1.0.1 对齐的计算基线。修改计算口径时必须同时补充测试；桌面能力主要在 `src/infrastructure/`、`src/ui/` 和 `src-tauri/` 演进。

## 构建与发布

GitHub Actions 在 Windows runner 上执行 `pnpm check` 并生成 MSI/NSIS。推送 `v*` 标签时会创建包含安装包的草稿 Release。

禁止向仓库提交真实成绩文件、导出结果、数据库或本地验收数据。

## License

项目基于 [GNU General Public License v3.0](LICENSE) 开源，仅供学习与个人使用，请勿用于商业用途。
