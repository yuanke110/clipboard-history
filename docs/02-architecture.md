# 技术架构设计

## 1. 总体架构

采用 Electron 双进程架构：

```
┌────────────────────────────────────────────────────────────┐
│                      主进程 (Main Process)                   │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Clipboard    │  │  Tray +      │  │  IPC Handler     │  │
│  │ Monitor      │  │  Shortcut    │  │  (bridge)        │  │
│  │ (轮询监听)    │  │  (托盘+快捷键)│  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Database (SQLite)                       │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │  history 表                                    │   │   │
│  │  │  id | content | type | image_path | summary    │   │   │
│  │  │  | timestamp | is_pinned                      │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬─────────────────────────────────┘
                           │ IPC
┌──────────────────────────▼─────────────────────────────────┐
│                   渲染进程 (Renderer Process)                 │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  React 应用                                         │    │
│  │                                                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │    │
│  │  │ TitleBar │ │ ToolBar  │ │   CardList       │   │    │
│  │  │ 标题栏   │ │ 搜索+筛选│ │   (虚拟滚动)      │   │    │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │    │
│  │  │ TextCard │ │ImageCard │ │  ImagePreview    │   │    │
│  │  │ 文字卡片 │ │ 图片卡片 │ │  大图预览弹窗     │   │    │
│  │  └──────────┘ └──────────┘ └──────────────────┘   │    │
│  └────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

## 2. 进程职责

### 主进程
- **Clipboard Monitor**: 每 500ms 轮询剪贴板，检测变化
- **Tray**: 系统托盘图标和右键菜单
- **Global Shortcut**: 注册 Win+V 快捷键
- **Database**: SQLite 读写，过期清理
- **IPC Handler**: 处理渲染进程的数据库请求

### 渲染进程
- **React UI**: 展示卡片列表，处理用户交互
- **组件树**: App → TitleBar + ToolBar + CardList → TextCard/ImageCard + ImagePreview

## 3. 数据流

```
用户复制 (Ctrl+C)
    │
    ▼
主进程 Clipboard Monitor 检测到变化
    │
    ├─ 文字 → 存入 SQLite（content + summary + type='text'）
    │
    └─ 图片 → 保存图片到 images/ 文件夹 → 存入 SQLite（type='image' + image_path）
    │
    ▼
渲染进程查询数据库 → 渲染卡片列表
    │
    ▼
用户操作卡片
    ├─ 复制 → IPC 通知主进程写入系统剪贴板 → 窗口隐藏
    ├─ 置顶 → IPC 通知主进程更新 is_pinned 字段 → 刷新列表
    ├─ 删除 → IPC 通知主进程删除记录 → 刷新列表
    └─ 搜索 → 渲染进程本地筛选 / IPC 查数据库
```

## 4. 数据库设计

### history 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 主键 |
| content | TEXT | 文字内容（图片类型可为空） |
| type | TEXT | 'text' 或 'image' |
| image_path | TEXT | 图片文件路径（文字类型为空） |
| summary | TEXT | 文字前100字摘要（用于搜索） |
| timestamp | DATETIME | 记录创建时间 |
| is_pinned | INTEGER DEFAULT 0 | 是否置顶（0/1） |

### 索引
- `idx_history_timestamp` ON timestamp
- `idx_history_type` ON type
- `idx_history_is_pinned` ON is_pinned

## 5. 关键依赖

| 包名 | 用途 |
|------|------|
| electron | 桌面框架 |
| react + react-dom | UI 框架 |
| sql.js | SQLite 数据库（WASM 模式，无需原生编译） |
| electron-vite | 构建工具 |
| electron-builder | 打包为 exe |

## 6. 安全与隐私

- 所有数据存储在本地 SQLite 文件（存放于 app.getPath('userData')）
- 图片存储在 userData/images/ 文件夹
- 无网络请求，不上传任何数据
- 不注册任何系统钩子，仅轮询读取剪贴板

## 7. 数据库初始化

使用 sql.js（WASM 版 SQLite）在 Electron 主进程中同步操作：

```ts
// 主进程启动时加载数据库文件
// 数据库文件存放在 app.getPath('userData')/clipboard-history.db
// sql.js 在 WASM 环境中运行，无需原生编译
```

优点：无需 node-gyp 编译，跨平台兼容性好，适合单进程本地读写。
缺点：不适合高并发写入（本项目无此需求）。
