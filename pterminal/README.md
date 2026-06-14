# PTerminal

A macOS-native AI terminal built with Tauri v2, React, and Rust. Each terminal
is an isolated PTY session with its own working directory, saved commands,
and AI context.

## Features

- **Isolated terminals** — each terminal runs its own real PTY (zsh by default),
  fully thread-isolated with independent state.
- **Three-column layout** — terminal list · xterm.js view · assistant panel,
  with draggable resizers and dark/light themes.
- **Command assistant** — save common commands (global or per-terminal), pin
  favorites, and re-run them instantly.
- **AI assistant** — chat, natural-language → command generation, and output
  explanation. Streams responses token-by-token. Supports OpenAI, Anthropic
  Claude, and local Ollama out of the box.
- **Persistent** — terminals, commands, SSH shortcuts, settings, and AI conversations are
  stored in a local SQLite database.

## Tech stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Shell    | Tauri v2 + Rust                              |
| Frontend | React 19 + TypeScript + Vite                 |
| Styling  | Tailwind CSS v4 + CSS variables              |
| State    | Zustand                                      |
| Terminal | @xterm/xterm + addon-fit + addon-web-links   |
| PTY      | portable-pty (Rust)                          |
| Database | SQLite (rusqlite + r2d2 connection pool)     |
| AI       | reqwest streaming (OpenAI-compatible + Anthropic) |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+ (managed via nvm recommended)
- [Rust](https://www.rust-lang.org/) stable (rustup)
- macOS 11+

Optional, for local AI:
- [Ollama](https://ollama.com/) running on `localhost:11434`

## Getting started

```bash
cd pterminal
npm install
npm run tauri dev
```

The first build compiles all Rust dependencies and may take a few minutes.

### Production build

```bash
npm run tauri build
```

Produces a `.app` bundle in `src-tauri/target/release/bundle/`.

## Configuration

Open the AI settings dialog (⚙ in the assistant panel) to configure:

| Field    | Ollama (local)                 | OpenAI                       | Anthropic                          |
|----------|--------------------------------|------------------------------|------------------------------------|
| Provider | `ollama`                       | `openai`                     | `anthropic`                        |
| API Key  | *(not required)*               | `sk-...`                     | `sk-ant-...`                       |
| Model    | `llama3.2`                     | `gpt-4o-mini`                | `claude-3-5-sonnet-latest`         |
| Base URL | `http://localhost:11434`       | `https://api.openai.com`     | `https://api.anthropic.com`        |

Settings persist in the local SQLite database.

## Keyboard shortcuts

| Shortcut        | Action                  |
|-----------------|-------------------------|
| `⌘T`            | New terminal            |
| `⌘W`            | Close active terminal   |
| `⌘⇧]` / `⌘⇧[`  | Next / previous terminal |
| `⌘⇧P`           | Toggle right panel      |
| `⌘⇧L`           | Toggle dark / light     |

## Project structure

```
pterminal/
├── src/                      # React frontend
│   ├── components/
│   │   ├── ai/               # AI chat panel, suggest bar, settings
│   │   ├── commands/         # Common commands panel
│   │   ├── layout/           # Three-column layout + resizers
│   │   └── terminal/         # xterm.js wrapper
│   ├── hooks/                # Tauri events, AI stream, shortcuts
│   ├── services/             # Tauri invoke wrappers
│   ├── stores/               # Zustand stores
│   └── types/                # Shared TypeScript types
└── src-tauri/
    └── src/
        ├── ai/               # LLM client, prompts, SSE stream parser
        ├── commands/         # Tauri commands (terminal/commands/ssh/ai/settings)
        ├── db.rs             # SQLite pool + migrations
        ├── state.rs          # AppState + live PTY sessions
        └── models.rs         # DTO structs
```

## Database schema

Core tables (auto-created on first launch):

- `terminals` — terminal configurations (name, cwd, shell)
- `commands` — saved commands (global when `terminal_id` is NULL)
- `ssh_shortcuts` — saved SSH connection shortcuts
- `ai_messages` — AI conversation turns per terminal
- `settings` — key/value application settings (incl. AI config)

The database lives at
`~/Library/Application Support/com.pterminal.app/pterminal.db`.
