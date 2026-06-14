# PTerminal 项目计划

## 1. 项目目标

构建一款 macOS 原生 AI 终端工具，参考 CapitalBuddy 的架构思路，核心特点：

- 支持多个完全独立的终端实例（线程级隔离）
- 三列布局：左侧终端列表、中间 xterm.js 终端窗口、右侧命令辅助面板
- 每个终端拥有独立的：工作目录、常用命令、历史命令、AI 上下文
- AI 加持：智能补全、自然语言生成命令、AI 对话面板、命令输出解释/错误诊断
- 数据持久化：SQLite 保存终端配置、常用命令、历史命令、AI 对话记录

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面壳 | Tauri v2 + Rust | 原生窗口、菜单、系统托盘、IPC |
| 前端 | React 19 + TypeScript + Vite | UI 框架 |
| 样式 | Tailwind CSS v4 + CSS Variables | 主题/暗色模式 |
| 状态 | Zustand | 全局状态管理 |
| 终端渲染 | @xterm/xterm + @xterm/addon-fit | 终端 UI |
| 后端 PTY | portable-pty (Rust) | 真实伪终端 |
| 数据库 | SQLite + sqlx / rusqlite | 本地持久化 |
| AI 层 | Rust async HTTP 客户端 | 支持 OpenAI/Claude/Ollama 等 |

选择 Tauri 而非 Electron 的原因：
- 与 CapitalBuddy 参考架构一致，便于复用 PTY 和事件流模式
- Rust 端可直接使用 `portable-pty` 创建真实 PTY，避免 Node 进程复杂性
- 更小的包体积和更好的 macOS 原生体验

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Tauri App                            │
├─────────────────────────────┬───────────────────────────────┤
│      Frontend (React)       │       Backend (Rust)          │
│  ┌─────┬─────────┬────────┐ │  ┌─────────┐  ┌───────────┐  │
│  │左列 │  中列   │ 右列   │ │  │ Terminal│  │ AI Service│  │
│  │终端 │ xterm.js│ 常用/  │ │  │ Manager │  │ (LLM CLI) │  │
│  │列表 │         │ 历史   │ │  └────┬────┘  └─────┬─────┘  │
│  └─────┴────┬────┴────────┘ │       │             │        │
│             │               │  ┌────┴─────────────┴────┐   │
│        Tauri IPC / Events   │  │      SQLite DB        │   │
│             │               │  │ terminals/commands/   │   │
│             ▼               │  │ history/messages      │   │
│       Zustand Store         │  └───────────────────────┘   │
└─────────────────────────────┴───────────────────────────────┘
```

### 核心数据流

1. 用户创建/选择终端 → 前端通过 `invoke('terminal_spawn')` 请求 Rust 创建 PTY
2. Rust 返回 `terminal_id`，启动 OS 线程读取 PTY 输出，通过 Tauri event `terminal-data` 推送给前端
3. 用户在 xterm.js 输入 → `onData` 触发 `invoke('terminal_write')` 写入 PTY
4. 用户执行命令后，Rust 捕获回车键事件，将命令存入该终端的 `history` 表
5. 右侧常用命令/历史命令面板从 SQLite 加载当前终端的数据
6. AI 功能通过 Rust 的 `ai_service` 异步调用 LLM API，流式结果通过 event 返回前端

## 4. 数据模型（SQLite）

### terminals 表
```sql
CREATE TABLE terminals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cwd TEXT NOT NULL,
    shell TEXT,
    env TEXT, -- JSON
    created_at INTEGER,
    updated_at INTEGER,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
);
```

### commands 表（常用命令）
```sql
CREATE TABLE commands (
    id TEXT PRIMARY KEY,
    terminal_id TEXT, -- NULL 表示全局常用命令
    label TEXT NOT NULL,
    command TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    pin_order INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER,
    FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
);
```

### command_history 表
```sql
CREATE TABLE command_history (
    id TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    command TEXT NOT NULL,
    executed_at INTEGER,
    exit_code INTEGER,
    FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
);
```

### ai_messages 表
```sql
CREATE TABLE ai_messages (
    id TEXT PRIMARY KEY,
    terminal_id TEXT NOT NULL,
    role TEXT NOT NULL, -- user / assistant / system / tool
    content TEXT NOT NULL,
    message_type TEXT, -- chat / command_suggest / output_explain / error_diagnose
    metadata TEXT, -- JSON: model, tokens, etc.
    created_at INTEGER,
    FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE
);
```

### settings 表
```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

## 5. 后端设计（Rust）

### 模块划分

```
src-tauri/src/
├── lib.rs              # Tauri 启动、状态管理、事件注册
├── state.rs            # AppStateInner, TerminalSession
├── db.rs               # SQLite 连接池与迁移
├── commands/
│   ├── terminal.rs     # terminal_spawn / write / resize / kill / list
│   ├── commands.rs     # 常用命令 CRUD、置顶
│   ├── history.rs      # 历史命令查询
│   └── ai.rs           # AI 请求、流式响应
├── ai/
│   ├── mod.rs          # AiService 定义
│   ├── client.rs       # LLM HTTP 客户端
│   ├── prompt.rs       # 提示词模板
│   └── stream.rs       # SSE 流处理
└── models.rs           # DTO 结构体
```

### 核心结构

```rust
// state.rs
pub struct TerminalSession {
    pub id: String,
    pub writer: Box<dyn PtyWriter + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub cwd: PathBuf,
}

pub struct AppStateInner {
    pub db: SqlitePool,
    pub terminal_sessions: Arc<RwLock<HashMap<String, Arc<TerminalSession>>>>,
    pub ai_service: AiService,
}
```

### Tauri Commands

| Command | 参数 | 返回 | 说明 |
|---------|------|------|------|
| `terminal_spawn` | `{ cwd, shell, env }` | `TerminalDto` | 创建 PTY 并启动 shell |
| `terminal_write` | `{ id, data }` | `()` | 写入键盘输入 |
| `terminal_resize` | `{ id, cols, rows }` | `()` | 调整 PTY 尺寸 |
| `terminal_kill` | `{ id }` | `()` | 关闭终端 |
| `terminal_list` | - | `Vec<TerminalDto>` | 列出所有终端 |
| `terminal_update` | `{ id, name, cwd }` | `TerminalDto` | 更新终端信息 |
| `terminal_delete` | `{ id }` | `()` | 删除终端 |
| `command_create` | `{ terminal_id, label, command }` | `CommandDto` | 创建常用命令 |
| `command_update` | `{ id, ... }` | `CommandDto` | 更新常用命令 |
| `command_delete` | `{ id }` | `()` | 删除常用命令 |
| `command_pin` | `{ id, is_pinned, pin_order }` | `CommandDto` | 置顶/取消置顶 |
| `command_list` | `{ terminal_id }` | `Vec<CommandDto>` | 列出常用命令 |
| `history_list` | `{ terminal_id, limit }` | `Vec<HistoryDto>` | 列出历史命令 |
| `history_clear` | `{ terminal_id }` | `()` | 清空历史 |
| `ai_chat` | `{ terminal_id, message, context }` | 流式 event | AI 对话 |
| `ai_suggest` | `{ terminal_id, prompt }` | 流式 event | 自然语言生成命令 |
| `ai_explain` | `{ terminal_id, output }` | 流式 event | 解释输出 |
| `ai_settings` | `{ provider, api_key, model }` | `()` | 保存 AI 配置 |

### PTY 实现要点

参考 CapitalBuddy 的 `src-tauri/src/commands/terminal.rs`：

1. 使用 `native_pty_system()` 获取系统 PTY
2. 打开 PTY 时指定 `PtySize { cols, rows, pixel_width, pixel_height }`
3. 使用用户默认 shell（`$SHELL` 或 `/bin/zsh`）
4. 设置环境变量 `TERM=xterm-256color`、`COLORTERM=truecolor`
5. 在独立 OS 线程中循环读取 PTY master，通过 `app.emit("terminal-data", { id, data })` 推送
6. 终端退出时发送 `terminal-exit` 事件

### 命令历史捕获

在 `terminal_write` 中检测换行符（`\r` 或 `\n`）。由于 xterm.js 的 `onData` 每次按键都会触发，需要在 Rust 端维护一个按终端 ID 划分的 `input_buffer`。当收到 `\r` 时，将缓冲区内容作为一条命令记录到 `command_history`，并清空缓冲区。

更可靠的方式：结合 xterm.js 的 `onData` 与 PTY 回显，在 Rust 端通过简单的行编辑状态机捕获当前行，回车时保存。

## 6. 前端设计（React）

### 目录结构

```
src-web/src/
├── main.tsx
├── App.tsx
├── index.css
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx      # 三列布局 + resize
│   │   ├── Resizer.tsx        # 可拖动分隔条
│   │   └── TitleBar.tsx       # 自定义标题栏（macOS）
│   ├── terminal/
│   │   ├── TerminalList.tsx   # 左列：终端列表 CRUD
│   │   ├── TerminalItem.tsx   # 单个终端项
│   │   ├── TerminalView.tsx   # 中列：xterm.js 封装
│   │   └── TerminalTabs.tsx   # 可选：标签切换
│   ├── commands/
│   │   ├── CommandPanel.tsx   # 右列：常用/历史命令容器
│   │   ├── CommonCommands.tsx # 常用命令列表
│   │   ├── CommandHistory.tsx # 历史命令列表
│   │   ├── CommandForm.tsx    # 新增/编辑命令表单
│   │   └── CommandCard.tsx    # 命令卡片（支持双击）
│   └── ai/
│       ├── AIChatPanel.tsx    # AI 对话面板
│       ├── AISuggestBar.tsx   # 自然语言命令输入
│       └── AIExplainDialog.tsx # 输出解释弹窗
├── hooks/
│   ├── useTerminal.ts         # xterm.js 生命周期管理
│   ├── useTauriEvents.ts      # 监听 terminal-data / terminal-exit
│   └── useAIStream.ts         # AI 流式响应处理
├── stores/
│   └── appStore.ts            # Zustand 全局状态
├── services/
│   ├── terminalService.ts     # Tauri invoke 封装
│   ├── commandService.ts      # 命令相关 invoke 封装
│   └── aiService.ts           # AI 相关 invoke 封装
└── types/
    └── index.ts
```

### 三列布局

```
┌──────────┬──────────────────────┬──────────┐
│  左列    │       中列            │  右列    │
│  280px   │      flex-1          │  320px   │
│ 可调整   │      可调整          │ 可调整   │
├──────────┼──────────────────────┼──────────┤
│ [+] 新建 │ ┌──────────────────┐ │ 常用命令 │
│ 终端 1   │ │                  │ │ ▼ 置顶  │
│ 终端 2   │ │   xterm.js       │ │ ──────── │
│ 终端 3   │ │                  │ │ 历史命令 │
│          │ │                  │ │ ──────── │
│          │ └──────────────────┘ │ AI 助手  │
│          │ [输入栏/AI建议栏]    │          │
└──────────┴──────────────────────┴──────────┘
```

### xterm.js 实现（参考 CapitalBuddy）

```ts
const terminal = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  lineHeight: 1.25,
  scrollback: 10000,
  theme: {
    background: 'var(--terminal-bg)',
    foreground: 'var(--terminal-fg)',
    cursor: 'var(--terminal-cursor)',
    selectionBackground: 'var(--terminal-selection)',
  },
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(containerRef.current);
terminal.focus();
fitAddon.fit();

// 输入 → Rust
terminal.onData((data) => {
  terminalService.write(id, data);
});

// Rust 输出 → xterm
terminal.onData 的反向：监听 Tauri event `terminal-data`，匹配 id 后 `terminal.write(data)`。
```

### 状态管理（Zustand）

```ts
interface AppState {
  terminals: Terminal[];
  activeTerminalId: string | null;
  
  // 当前终端的辅助数据
  commonCommands: Command[];
  historyCommands: HistoryItem[];
  aiMessages: AIMessage[];
  
  // UI 状态
  leftWidth: number;
  rightWidth: number;
  isDarkMode: boolean;
  
  // Actions
  setActiveTerminal: (id: string) => void;
  createTerminal: (name: string, cwd: string) => Promise<void>;
  deleteTerminal: (id: string) => Promise<void>;
  sendCommandToTerminal: (id: string, command: string) => Promise<void>;
  loadTerminalAuxData: (id: string) => Promise<void>;
  // ...
}
```

### 双击命令输入到终端

实现逻辑：
1. 用户双击右侧面板的命令卡片
2. 调用 `terminalService.write(activeTerminalId, command + '\r')`
3. 同时将该命令加入该终端的 `command_history`（由 Rust 在收到 `\r` 时处理）

## 7. AI 功能设计

### AI 服务层（Rust）

```rust
pub struct AiService {
    client: reqwest::Client,
    config: AIConfig,
}

impl AiService {
    pub async fn chat_stream(&self, messages: Vec<Message>) -> Result<Stream, Error>;
    pub async fn suggest_command(&self, context: TerminalContext, prompt: &str) -> Result<Stream, Error>;
    pub async fn explain_output(&self, context: TerminalContext, output: &str) -> Result<Stream, Error>;
    pub async fn diagnose_error(&self, context: TerminalContext, output: &str) -> Result<Stream, Error>;
}
```

### 支持的 LLM Provider

- OpenAI (GPT-4o / GPT-4o-mini)
- Anthropic (Claude 3.5 Sonnet)
- Ollama（本地模型）
- 可扩展：通过统一接口添加其他 provider

### 提示词策略

1. **智能补全**：基于当前输入前缀 + 终端 CWD + 最近历史，请求 LLM 生成候选命令
2. **自然语言生成命令**：用户输入自然语言 → LLM 生成可执行 shell 命令
3. **输出解释**：选中终端输出 → LLM 用中文解释其含义
4. **错误诊断**：捕获命令非零退出码的输出 → LLM 分析原因并给出修复建议
5. **AI 对话面板**：保留该终端的上下文，支持多轮对话

### 流式响应

- Rust 端使用 SSE 解析 LLM 响应
- 通过 Tauri event `ai-delta` 分段推送给前端
- 前端使用 `requestAnimationFrame` 批量处理 delta，减少渲染抖动（参考 CapitalBuddy）

## 8. 实现阶段

### Phase 1: 项目骨架（Day 1）
- [ ] 初始化 Tauri v2 + React + TypeScript + Vite 项目
- [ ] 配置 Tailwind CSS、Zustand、xterm.js
- [ ] 配置 SQLite 与迁移脚本
- [ ] 搭建三列布局与 resize 组件

### Phase 2: 终端核心（Day 2-3）
- [ ] 实现 Rust PTY 管理（spawn / write / resize / kill）
- [ ] 实现 xterm.js 组件与 Tauri 事件绑定
- [ ] 实现终端列表 CRUD
- [ ] 实现命令历史捕获与持久化

### Phase 3: 命令辅助面板（Day 3-4）
- [ ] 常用命令 CRUD + 置顶排序
- [ ] 历史命令列表展示与清空
- [ ] 双击命令输入到当前终端
- [ ] 数据按终端 ID 隔离

### Phase 4: AI 功能（Day 4-6）
- [ ] 实现 LLM 客户端与 SSE 流解析
- [ ] AI 设置界面（provider / api_key / model）
- [ ] 自然语言命令生成
- [ ] 智能命令补全（可选快捷键触发）
- [ ] 输出解释与错误诊断
- [ ] AI 对话面板

### Phase 5: 打磨与打包（Day 6-7）
- [ ] 暗色/亮色主题切换
- [ ] 键盘快捷键（新建终端、切换终端、聚焦输入等）
- [ ] 错误处理与日志
- [ ] macOS 打包（.app / .dmg）
- [ ] 基础测试

## 9. 关键设计决策

1. **终端隔离**：每个终端独立 PTY 进程，独立 SQLite 关联数据
2. **历史命令捕获**：Rust 端维护输入缓冲区，检测到回车时保存
3. **AI 上下文绑定**：AI 对话和命令建议都基于当前活跃终端的上下文
4. **常用命令范围**：支持全局常用命令 + 每个终端的私有常用命令
5. **流式响应优化**：前端使用 requestAnimationFrame 批处理 AI delta
6. **持久化策略**：所有配置、命令、历史、对话均落盘 SQLite

## 10. 风险与应对

| 风险 | 应对 |
|------|------|
| xterm.js 与 Tauri v2 事件兼容 | 参考 CapitalBuddy 已验证的模式 |
| PTY 进程残留 | 应用退出和终端关闭时强制 kill child |
| 命令历史捕获不准确 | 使用输入缓冲区 + 回车检测，允许后期优化 |
| AI 流式渲染性能 | requestAnimationFrame 批处理 + 虚拟列表 |
| SQLite 并发 | 使用连接池或单写队列 |

## 11. 推荐下一步

按 Phase 1 开始实施：先搭建 Tauri + React 项目骨架，配置数据库和基础布局，再逐步实现终端核心功能。
