<p align="center">
  <img src="images/logo.png" alt="Aider Chat logo" width="180">
</p>

<h1 align="center">Aider Chat</h1>

<p align="center">
  A VS Code / Cursor extension that gives you a sidebar chat interface to
  <a href="https://aider.chat">Aider</a>, with one-click switching between a
  <strong>local</strong> Ollama backend (zero token cost) and a <strong>remote</strong>
  Claude API backend.
</p>

---

## Features

- **Sidebar chat panel** — talk to Aider in a dedicated webview, not a raw terminal
- **"Driven by" dropdown** — switch between Local (Ollama) and Remote (Claude API) right from the chat panel
- **Ollama lifecycle management** — Ollama starts automatically in local mode and shuts down when you switch to remote, freeing VRAM/RAM
- **File context management** — right-click files, use the attach button, or command palette to add/remove files from Aider's context
- **Claude API support** — use your Anthropic API key for Claude Opus / Sonnet via Aider
- **Status bar indicator** — shows current provider and running state at a glance
- **`.env` file support** — keep API keys out of settings and source control
- **"Processing…" indicator** — animated dots while waiting for Aider to respond
- **Theme-aware UI** — chat panel matches your VS Code dark/light theme automatically

<p align="center">
  <img src="images/chat_window.jpg" alt="Chat panel with provider dropdown and AI response" width="600">
</p>

## Prerequisites

| Tool | Purpose | Install |
|------|---------|---------|
| [Aider](https://aider.chat) | AI pair programming CLI | `pip install aider-chat` |
| [Ollama](https://ollama.com) | Local LLM server (local mode) | `curl -fsSL https://ollama.com/install.sh \| sh` |
| A coding model | Local inference | `ollama pull qwen2.5-coder:14b` |
| Anthropic API key | Claude access (remote mode) | [console.anthropic.com](https://console.anthropic.com/) |

## Quick Start

```bash
# Clone & install
git clone <repo-url> && cd aider-agent
npm install

# Compile
npm run compile

# Launch in VS Code Extension Development Host
# Press F5 in VS Code / Cursor
```

Set up your API key (optional, for remote/Claude mode):

```bash
cp .env.example .env
# Edit .env with your real Anthropic key
```

Once the extension is loaded:

1. Click the **chat bubble icon** in the Activity Bar (drag it to the right sidebar if you prefer)
2. Run **Aider: Start Engine** from the command palette (`Ctrl+Shift+P`)
3. Type a message in the chat panel and hit Enter

## Architecture

### File Structure

```
aider-agent/
├── package.json                  # Extension manifest, commands, settings, views
├── tsconfig.json                 # TypeScript config (ESNext, NodeNext)
├── eslint.config.mjs             # ESLint flat config with typescript-eslint
├── .env.example                  # Template for API keys (copy to .env)
├── .vscodeignore                 # Files excluded from VSIX package
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI: compile, lint, test on push/PR
│       └── publish.yml           # Publish to VS Code Marketplace + Open VSX
├── .vscode/
│   └── settings.json             # Workspace defaults (model, provider, extra args)
├── src/
│   ├── extension.ts              # Activation, process management, command wiring
│   ├── chatViewProvider.ts       # WebviewViewProvider — chat UI + message protocol
│   └── test/
│       ├── extension.test.ts     # Integration tests (activation, commands, config)
│       └── chatViewProvider.test.ts  # Unit tests (message protocol, HTML, handlers)
└── dist/                         # Compiled output (gitignored)
```

### Component Diagram

```mermaid
graph TD
    subgraph VS Code / Cursor
        AB[Activity Bar<br>Chat icon]
        SB[Status Bar<br>▶ Aider: Local]
        WV[Chat Webview<br>Messages · Input · Attach]
        EXT[extension.ts<br>EngineState · Commands]
        CVP[ChatViewProvider<br>WebviewViewProvider]
    end

    AB -->|opens| WV
    SB -->|click| EXT
    WV -->|postMessage<br>send / action| CVP
    CVP -->|onSend · onAction| EXT
    EXT -->|postMessage<br>aiChunk · status| CVP
    CVP -->|webview.postMessage| WV

    EXT -->|spawn + stdin| AIDER[Aider<br>Child Process]
    AIDER -->|stdout / stderr| EXT

    EXT -->|spawn / kill| OLLAMA[Ollama Server<br>local mode]
    AIDER -->|inference| OLLAMA
    AIDER -->|API call| CLAUDE[Claude API<br>remote mode]

    EXT -->|/add · /drop| AIDER
```

### Message Flow: Chat

```mermaid
sequenceDiagram
    participant W as Chat Webview
    participant E as extension.ts
    participant A as Aider Process

    W->>E: { command: 'send', text: 'fix the bug' }
    E->>A: stdin.write('fix the bug\n')
    E->>W: { type: 'userMessage', text: 'fix the bug' }
    E->>W: { type: 'thinking', text: 'show' }

    Note over W: "Processing…" with animated dots

    A->>E: stdout data (first chunk)
    E->>W: { type: 'thinking', text: 'hide' }
    E->>W: { type: 'aiChunk', text: '...' }

    loop remaining chunks
        A->>E: stdout data (chunk)
        E->>E: stripAnsi(chunk)
        E->>W: { type: 'aiChunk', text: '...' }
    end

    Note over E: 800ms silence
    E->>W: { type: 'aiDone' }
```

### Message Flow: File Context

```mermaid
sequenceDiagram
    participant U as User
    participant E as extension.ts
    participant A as Aider Process
    participant W as Chat Webview

    alt Right-click file in Explorer
        U->>E: aiderAgent.addFile(uri)
    else Click + button in chat
        U->>W: click attach button
        W->>E: { command: 'action', action: 'pickFiles' }
        E->>U: showOpenDialog (multi-select)
        U->>E: selected files
    else Command palette
        U->>E: aiderAgent.addFile()
    end

    E->>A: stdin.write('/add src/foo.ts\n')
    E->>W: { type: 'status', text: 'Added: src/foo.ts' }
```

### Provider Switch: Local → Remote

```mermaid
sequenceDiagram
    participant U as User
    participant E as extension.ts
    participant O as Ollama
    participant A as Aider

    U->>E: switchProvider()
    E->>A: aiderProcess.kill()
    destroy A
    A-->>E: exited
    E->>O: pkill ollama serve
    destroy O
    O-->>E: stopped (VRAM freed)
    E->>E: config.update('provider', 'remote')
    E->>U: "Switched to Remote (Claude API)"
```

### Provider Switch: Remote → Local

```mermaid
sequenceDiagram
    participant U as User
    participant E as extension.ts
    participant O as Ollama

    U->>E: switchProvider()
    E->>O: spawn('ollama', ['serve'])
    activate O
    E->>E: config.update('provider', 'local')
    E->>U: "Switched to Local (Ollama)"
```

### Ollama Lifecycle

Ollama is treated as a managed resource. The extension owns its lifecycle:

| Event | Ollama action |
|-------|--------------|
| Start engine (local) | `spawn('ollama', ['serve'])` — sets `OLLAMA_API_BASE` |
| Stop engine (local) | `kill` + `pkill -f 'ollama serve'` |
| Switch to remote | Kill Ollama immediately (free VRAM) |
| Switch to local | Start Ollama immediately |
| Extension deactivate | Kill if running |

## Commands

| Command | Palette title | Description |
|---------|---------------|-------------|
| `aiderAgent.start` | Aider: Start Engine | Start Aider with the configured provider |
| `aiderAgent.stop` | Aider: Stop Engine | Stop Aider (and Ollama if local) |
| `aiderAgent.switchProvider` | Aider: Switch Provider (Local / Remote) | Toggle between Ollama and Claude API |
| `aiderAgent.addFile` | Aider: Add File to Chat | Add active file or right-clicked file to Aider context (`/add`) |
| `aiderAgent.removeFile` | Aider: Remove File from Chat | Remove file from Aider context (`/drop`) |
| `aiderAgent.pickFiles` | Aider: Pick Files to Add… | Open multi-file picker dialog |

### Context Menus

**"Aider: Add File to Chat"** and **"Aider: Remove File from Chat"** appear in:
- File Explorer right-click menu
- Editor right-click menu
- Editor tab right-click menu

The chat panel also has a **+** button next to the input that opens the file picker.

<p align="center">
  <img src="images/add%20to%20chat.jpg" alt="Right-click context menu showing Add File to Chat" width="420">
</p>

## Configuration

### `.env` file (recommended for secrets)

Create a `.env` file in your workspace root to keep API keys out of settings and version control:

```bash
cp .env.example .env
```

```env
# .env — gitignored, never committed
ANTHROPIC_API_KEY=sk-ant-api03-your-real-key-here
# OLLAMA_API_BASE=http://localhost:11434
```

### Priority order

Values are resolved highest-priority-first:

```mermaid
graph LR
    A[.env file] -->|overrides| B[System env vars]
    B -->|overrides| C[VS Code settings]
```

| Source | Committed? | Best for |
|--------|-----------|----------|
| `.env` file | No (`*.env` in `.gitignore`) | API keys, per-project overrides |
| System environment variable | No | Machine-wide defaults |
| VS Code settings (`aiderAgent.*`) | Optional | Model selection, extra args |

### VS Code settings

All settings live under the `aiderAgent` namespace. Open with `Ctrl+,` and search "Aider Chat".

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `aiderAgent.provider` | `"local" \| "remote"` | `"local"` | Active LLM backend |
| `aiderAgent.local.model` | `string` | `"ollama_chat/qwen2.5-coder:14b"` | Ollama model tag for Aider |
| `aiderAgent.local.apiBase` | `string` | `"http://localhost:11434"` | Ollama API base URL |
| `aiderAgent.remote.model` | `string` | `"claude-sonnet-4-20250514"` | Claude model identifier |
| `aiderAgent.remote.apiKey` | `string` | `""` | Anthropic API key (only if not using `.env`) |
| `aiderAgent.extraArgs` | `string[]` | `[]` | Additional CLI flags for Aider |

### Model Sizing Guide

| Machine | Usable RAM | Recommended model | Tag |
|---------|-----------|-------------------|-----|
| 32 GB shared VRAM (~20 GB free) | ~20 GB | Qwen 2.5 Coder 14B (~9 GB) | `ollama_chat/qwen2.5-coder:14b` |
| 64 GB shared VRAM (~52 GB free) | ~52 GB | Qwen 2.5 Coder 32B (~20 GB) | `ollama_chat/qwen2.5-coder:32b` |
| Any | n/a | DeepSeek Coder V2 16B (~9 GB) | `ollama_chat/deepseek-coder-v2:16b` |

### Example: use Claude Opus 4

```env
# .env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

```jsonc
// .vscode/settings.json
{
  "aiderAgent.provider": "remote",
  "aiderAgent.remote.model": "claude-opus-4-20250514"
}
```

### Example: use a different local model

```jsonc
{
  "aiderAgent.provider": "local",
  "aiderAgent.local.model": "ollama_chat/deepseek-coder-v2:16b"
}
```

## Development

```bash
npm run compile    # Build once
npm run watch      # Rebuild on save
npm run lint       # ESLint check
npm run fix        # ESLint auto-fix
npm run test       # Compile + lint + run extension tests
npm run test:only  # Run tests without recompiling
npm run package    # Build a .vsix for local install
```

### WSL2 testing prerequisites

Running the extension test suite inside WSL2 requires a few system libraries for the Electron test host:

```bash
sudo apt-get install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libx11-xcb1 libdrm2 libgbm1 libgtk-3-0 libasound2t64 xvfb
```

Then run tests under a virtual framebuffer:

```bash
xvfb-run -a npm run test:only
```

## CI / CD

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **ci.yml** | Push / PR to `main` or `master` | Compile, lint, test (with `xvfb`), package VSIX, upload artifact |
| **publish.yml** | GitHub Release published | Everything in CI, then publish to VS Code Marketplace (`VSCE_PAT`) and Open VSX (`OVSX_PAT`) |

To set up automated publishing, add `VSCE_PAT` and `OVSX_PAT` as repository secrets in GitHub.

## Project Layout

```
src/
├── extension.ts               # Entry point
│   ├── activate()             # Registers commands, status bar, chat view provider
│   ├── loadDotEnv()            # Reads .env file from workspace root
│   ├── startEngine()          # Spawns Aider (+ Ollama if local), sets OLLAMA_API_BASE
│   ├── stopEngine()           # Kills Aider (+ Ollama if local)
│   ├── switchProvider()       # Toggles local/remote, manages Ollama lifecycle
│   ├── handleChatInput()      # Writes user text to Aider stdin
│   ├── pipeToChat()           # Streams Aider stdout → chat view (ANSI-stripped)
│   ├── addFile() / removeFile()   # Sends /add and /drop to Aider stdin
│   └── pickFiles()            # Opens multi-file picker, sends /add for each
│
├── chatViewProvider.ts        # Sidebar webview
│   ├── resolveWebviewView()   # Builds HTML, wires message + action listeners
│   ├── addUserMessage()       # Posts user bubble to webview
│   ├── appendAiChunk()        # Streams AI text into current bubble
│   ├── markAiDone()           # Finalizes AI response bubble
│   ├── showThinking()         # Shows/hides "Processing…" indicator
│   └── showStatus()           # Adds centered status message
│
└── test/
    ├── extension.test.ts          # Integration: activation, commands, config defaults
    └── chatViewProvider.test.ts   # Unit: message protocol, HTML, send/action handlers
```

## License

MIT
