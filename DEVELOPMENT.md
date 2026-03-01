# Development Guide

Contributing to Aider Chat? This document covers the architecture, build process, testing, and CI/CD pipeline.

## Architecture

### File Structure

```
aider-chat/
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

## Project Layout

```
src/
├── extension.ts               # Entry point
│   ├── activate()             # Registers commands, status bar, chat view provider
│   ├── loadDotEnv()           # Reads .env file from workspace root
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
│   ├── setProvider()          # Syncs provider dropdown state
│   └── showStatus()           # Adds centered status message
│
└── test/
    ├── extension.test.ts          # Integration: activation, commands, config defaults
    └── chatViewProvider.test.ts   # Unit: message protocol, HTML, send/action handlers
```

## Building & Testing

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

Running the extension test suite inside WSL2 requires system libraries for the Electron test host:

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
