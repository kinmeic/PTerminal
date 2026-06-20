# PTerminal

PTerminal is a macOS-native AI terminal built with Tauri v2, React, TypeScript, and Rust. It combines real isolated PTY sessions, a clean three-column workspace, saved command workflows, SSH shortcuts, and an integrated AI assistant for command generation and terminal output explanation.

![PTerminal logo](pterminal/public/logo.png)

## Highlights

- **Native macOS desktop app** — powered by Tauri v2 with a lightweight React frontend and Rust backend.
- **Real isolated terminals** — each tab/session runs in its own PTY with independent working directory and shell state.
- **AI-assisted workflow** — chat with an assistant, generate shell commands from natural language, and explain terminal output.
- **Multiple AI providers** — supports OpenAI-compatible APIs, Anthropic Claude, and local Ollama.
- **Saved commands** — keep reusable commands globally or per terminal and rerun them quickly.
- **SSH shortcuts** — store common SSH connections for faster remote access.
- **Persistent local data** — terminals, commands, settings, SSH shortcuts, and AI conversations are stored locally in SQLite.
- **Customizable terminal** — dark/light themes, terminal font, line height, per-terminal zoom, and optional autocomplete.

## Tech stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 + Rust |
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 + CSS variables |
| State | Zustand |
| Terminal | xterm.js |
| PTY | portable-pty |
| Database | SQLite |
| AI | OpenAI-compatible APIs, Anthropic Claude, Ollama |

## Requirements

- macOS 11+
- [Node.js](https://nodejs.org/) 22+
- [Rust](https://www.rust-lang.org/tools/install) stable
- Optional: [Ollama](https://ollama.com/) for local AI models

## Getting started

```bash
git clone https://github.com/kinmeic/PTerminal.git
cd PTerminal/pterminal
npm install
npm run tauri dev
```

The first Tauri run may take a few minutes because Rust dependencies need to compile.

## Build

```bash
cd pterminal
npm run tauri build
```

macOS app bundles and DMG artifacts are generated under:

```text
pterminal/src-tauri/target/release/bundle/
```

## AI configuration

Open **Settings → Large Model Settings** in the app to configure your preferred provider.

| Provider | API key | Base URL | Example model |
| --- | --- | --- | --- |
| Ollama | Not required | `http://localhost:11434` | `llama3.2` |
| OpenAI-compatible | Required for hosted APIs | `https://api.openai.com` or compatible endpoint | `gpt-4o-mini` |
| Anthropic | Required | `https://api.anthropic.com` | `claude-3-5-sonnet-latest` |

Settings are saved locally. Do not commit API keys or secrets to the repository.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` | Create a new terminal |
| `⌘W` | Close the active terminal |
| `⌘⇧]` / `⌘⇧[` | Switch to next / previous terminal |
| `⌘⇧P` | Toggle the assistant panel |
| `⌘⇧L` | Toggle dark / light mode |

## Project structure

```text
PTerminal/
├── LICENSE
├── README.md
└── pterminal/
    ├── package.json
    ├── src/                  # React frontend
    └── src-tauri/            # Tauri/Rust backend
```

## Release workflow

The repository includes a GitHub Actions workflow at `.github/workflows/release.yml` for building macOS DMG releases for Apple Silicon and Intel Macs when version tags are pushed.

## Share on X.com

> Meet PTerminal — a macOS-native AI terminal built with Tauri, React, and Rust.\
> Isolated PTY sessions, saved commands, SSH shortcuts, local SQLite persistence, and AI help for command generation + output explanation.\
> BSD 3-Clause.\
> #Terminal #AI #macOS #Tauri #Rust

## License

PTerminal is licensed under the [BSD 3-Clause License](LICENSE).
