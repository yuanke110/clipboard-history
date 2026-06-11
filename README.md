# 历史粘贴板 (Clipboard History)

一款轻量级的 Windows 剪贴板历史记录工具，自动记录文字和图片，支持搜索、置顶、删除，以淡粉色卡片界面展示。

## 功能特性

- **剪贴板监听** — 自动记录所有复制的文字和图片内容
- **卡片式展示** — 时间降序排列，文字卡片与图片缩略图清晰展示
- **搜索筛选** — 支持关键词搜索，可按全部/文字/图片类型筛选
- **置顶管理** — 重要内容置顶，始终显示在列表最上方
- **图片预览** — 点击图片卡片弹出大图预览
- **自动清理** — 保留最近 7 天记录，置顶内容不受影响
- **全局快捷键** — `Ctrl+Shift+Z` 一键呼出/隐藏
- **屏幕吸附** — 窗口靠近屏幕边缘自动吸附贴边
- **系统托盘** — 最小化到托盘，后台静默运行
- **本地存储** — 所有数据存储在本地 SQLite，不上传云端，保护隐私

## 截图

> 淡粉色卡片界面，紧凑布局，支持文字和图片两种卡片样式。

## 技术栈

| 技术 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 跨平台桌面应用框架 |
| [React 18](https://react.dev/) | 渲染进程 UI 框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全 |
| [electron-vite](https://electron-vite.org/) | 构建工具 |
| [sql.js](https://github.com/sql-js/sql.js/) | SQLite (WebAssembly) 数据库 |
| [electron-builder](https://www.electron.build/) | 打包分发 |

## 项目结构

```
clipboard-history/
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.ts             # 入口：窗口、托盘、快捷键
│   │   ├── clipboard.ts         # 剪贴板轮询监听
│   │   └── database.ts          # SQLite 数据库操作
│   ├── preload/                 # 预加载脚本
│   │   └── index.ts             # IPC 桥接
│   └── renderer/                # 渲染进程
│       └── src/
│           ├── App.tsx           # 主应用组件
│           ├── components/
│           │   ├── TitleBar.tsx   # 自定义标题栏
│           │   ├── CardList.tsx   # 卡片列表容器
│           │   ├── TextCard.tsx   # 文字卡片
│           │   ├── ImageCard.tsx  # 图片卡片
│           │   └── ImagePreview.tsx # 大图预览
│           └── utils/
│               ├── time.ts       # 时间格式化
│               └── highlight.ts  # 搜索高亮
├── docs/                        # 项目文档
├── resources/                   # 应用图标
└── electron.vite.config.ts      # 构建配置
```

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- Windows 10/11

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 打包 Windows 安装包

```bash
npm run build:win
```

生成的 `.exe` 安装包位于 `dist/` 目录。

## 数据存储

- **数据库位置**: `%APPDATA%/clipboard-history/clipboard.db`
- **存储格式**: SQLite (通过 sql.js WebAssembly)
- **数据表**: `history` — 包含 id、content、type、image_path、summary、timestamp、is_pinned 字段
- **自动清理**: 启动时清理 7 天前的非置顶记录

## 窗口行为

| 行为 | 说明 |
|------|------|
| 默认尺寸 | 280 × 200px |
| 默认位置 | 屏幕右上靠中 (72% 宽度处) |
| 无边框 | 自定义标题栏 28px，工具栏 32px |
| 全局快捷键 | `Ctrl+Shift+Z` 呼出/隐藏 |
| 自动隐藏 | 鼠标离开 1.5 秒后滑入屏幕边缘，仅留 3px |

## 文档

- [需求规格](docs/01-requirements.md)
- [技术架构](docs/02-architecture.md)
- [UI/UX 设计](docs/03-design.md)
- [开发计划](docs/04-development-plan.md)
- [实现计划](docs/05-implementation-plan.md)

## 许可证

[MIT](LICENSE)
