import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { ChatViewProvider } from './chatViewProvider';

type Provider = 'local' | 'remote';

interface EngineState {
    aiderProcess: ChildProcess | null;
    ollamaProcess: ChildProcess | null;
    outputChannel: vscode.OutputChannel | null;
    statusBar: vscode.StatusBarItem | null;
    activeProvider: Provider;
}

const state: EngineState = {
    aiderProcess: null,
    ollamaProcess: null,
    outputChannel: null,
    statusBar: null,
    activeProvider: 'local',
};

let chatView: ChatViewProvider;
let responseTimer: ReturnType<typeof setTimeout> | undefined;

function cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('aiderAgent');
}

function out(): vscode.OutputChannel {
    if (!state.outputChannel) {
        state.outputChannel = vscode.window.createOutputChannel('Aider Chat');
    }
    return state.outputChannel;
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ── Status bar ──────────────────────────────────────────────────────

function updateStatusBar(running: boolean): void {
    if (!state.statusBar) return;

    if (running) {
        const label = state.activeProvider === 'local' ? 'Local' : 'Remote';
        state.statusBar.text = `$(pulse) Aider: ${label}`;
        state.statusBar.tooltip = `Aider running (${label}) — click to stop`;
        state.statusBar.command = 'aiderAgent.stop';
        state.statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
        const label = state.activeProvider === 'local' ? 'Local' : 'Remote';
        state.statusBar.text = `$(play) Aider: ${label}`;
        state.statusBar.tooltip = 'Click to start Aider';
        state.statusBar.command = 'aiderAgent.start';
        state.statusBar.backgroundColor = undefined;
    }
}

// ── Ollama lifecycle ────────────────────────────────────────────────

function startOllama(): void {
    if (state.ollamaProcess) return;

    out().appendLine('Starting Ollama…');
    try {
        state.ollamaProcess = spawn('ollama', ['serve'], {
            detached: true,
            stdio: 'ignore',
        });

        state.ollamaProcess.on('error', (err) => {
            out().appendLine(`[WARN] Could not start Ollama: ${err.message}`);
            out().appendLine('Install Ollama: https://ollama.com');
            state.ollamaProcess = null;
        });

        state.ollamaProcess.on('exit', () => {
            state.ollamaProcess = null;
        });

        state.ollamaProcess.unref();
    } catch (err) {
        out().appendLine(`[WARN] Ollama spawn failed: ${(err as Error).message}`);
        state.ollamaProcess = null;
    }
}

function stopOllama(): void {
    if (state.ollamaProcess) {
        state.ollamaProcess.kill();
        state.ollamaProcess = null;
    }
    spawn('pkill', ['-f', 'ollama serve']);
    out().appendLine('Ollama stopped — resources freed.');
}

// ── Aider args & env ────────────────────────────────────────────────

function buildAiderArgs(): string[] {
    const config = cfg();
    const provider = config.get<Provider>('provider') ?? 'local';
    state.activeProvider = provider;

    const args: string[] = [];

    if (provider === 'local') {
        const model = config.get<string>('local.model') ?? 'ollama_chat/qwen2.5-coder:14b';
        args.push('--model', model);
    } else {
        const model = config.get<string>('remote.model') ?? 'claude-sonnet-4-20250514';
        args.push('--model', model);
    }

    args.push(
        '--no-gui',
        '--no-show-model-warnings',
        '--no-fancy-input',
        '--no-pretty',
        '--no-suggest-shell-commands',
    );

    const extra = config.get<string[]>('extraArgs') ?? [];
    args.push(...extra);

    return args;
}

function loadDotEnv(): Record<string, string> {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsPath) return {};

    try {
        const raw = readFileSync(join(wsPath, '.env'), 'utf8');
        const vars: Record<string, string> = {};
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 1) continue;
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            vars[key] = val;
        }
        return vars;
    } catch {
        return {};
    }
}

function buildEnv(): NodeJS.ProcessEnv {
    const dotenv = loadDotEnv();
    const env = { ...process.env, ...dotenv };
    const config = cfg();

    if (config.get<Provider>('provider') === 'local') {
        const apiBase = config.get<string>('local.apiBase') ?? 'http://localhost:11434';
        env['OLLAMA_API_BASE'] = env['OLLAMA_API_BASE'] ?? apiBase;
    }

    if (config.get<Provider>('provider') === 'remote') {
        const key = config.get<string>('remote.apiKey');
        if (key && !env['ANTHROPIC_API_KEY']) {
            env['ANTHROPIC_API_KEY'] = key;
        }
    }

    return env;
}

// ── Send to Aider stdin ─────────────────────────────────────────────

function sendToAider(text: string): boolean {
    if (!state.aiderProcess?.stdin?.writable) {
        chatView.showStatus('Engine not running — start it first.');
        return false;
    }
    state.aiderProcess.stdin.write(text + '\n');
    out().appendLine(`[CMD] ${text}`);
    return true;
}

function handleChatInput(text: string): void {
    if (!sendToAider(text)) return;
    chatView.addUserMessage(text);
    chatView.showThinking(true);
}

// ── File context commands ───────────────────────────────────────────

function relPath(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
}

function addFile(uri?: vscode.Uri): void {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showWarningMessage('No file selected.');
        return;
    }
    const rel = relPath(target);
    if (sendToAider(`/add ${rel}`)) {
        chatView.showStatus(`Added: ${rel}`);
    }
}

function removeFile(uri?: vscode.Uri): void {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) {
        vscode.window.showWarningMessage('No file selected.');
        return;
    }
    const rel = relPath(target);
    if (sendToAider(`/drop ${rel}`)) {
        chatView.showStatus(`Removed: ${rel}`);
    }
}

async function pickFiles(): Promise<void> {
    const files = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFolders: false,
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        title: 'Select files to add to Aider context',
    });
    if (!files?.length) return;

    for (const f of files) {
        const rel = relPath(f);
        sendToAider(`/add ${rel}`);
    }
    chatView.showStatus(`Added ${files.length} file(s) to context.`);
}

// ── Process I/O → chat view ─────────────────────────────────────────

function pipeToChat(stream: Readable | null, label: string): void {
    if (!stream) return;

    stream.on('data', (chunk: Buffer) => {
        const raw = chunk.toString('utf8');
        out().append(`[${label}] ${raw}`);

        const clean = stripAnsi(raw);
        if (!clean.trim()) return;

        chatView.showThinking(false);
        chatView.appendAiChunk(clean);

        if (responseTimer) clearTimeout(responseTimer);
        responseTimer = setTimeout(() => chatView.markAiDone(), 800);
    });
}

// ── Engine start / stop ─────────────────────────────────────────────

async function startEngine(): Promise<void> {
    if (state.aiderProcess) {
        vscode.window.showWarningMessage('Aider is already running.');
        return;
    }

    const channel = out();
    const provider = cfg().get<Provider>('provider') ?? 'local';
    state.activeProvider = provider;

    if (provider === 'local') {
        startOllama();
    }

    if (provider === 'remote') {
        stopOllama();

        const key = cfg().get<string>('remote.apiKey');
        if (!key && !process.env['ANTHROPIC_API_KEY']) {
            const action = await vscode.window.showWarningMessage(
                'No API key found. Set it in settings or the ANTHROPIC_API_KEY env var.',
                'Open Settings',
            );
            if (action === 'Open Settings') {
                await vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'aiderAgent.remote.apiKey',
                );
            }
            return;
        }
    }

    const args = buildAiderArgs();
    const cmdLine = `aider ${args.join(' ')}`;
    channel.appendLine(`[${provider}] > ${cmdLine}`);
    chatView.showStatus(`Starting (${provider === 'local' ? 'Ollama' : 'Claude API'})…`);

    try {
        state.aiderProcess = spawn('aider', args, {
            cwd: vscode.workspace.workspaceFolders?.[0].uri.fsPath,
            env: buildEnv(),
            shell: true,
        });

        pipeToChat(state.aiderProcess.stdout, 'STDOUT');
        pipeToChat(state.aiderProcess.stderr, 'STDERR');

        state.aiderProcess.on('error', (err) => {
            channel.appendLine(`[ERROR] Aider failed to start: ${err.message}`);
            chatView.showStatus(`Failed to start: ${err.message}`);
            state.aiderProcess = null;
            updateStatusBar(false);
        });

        state.aiderProcess.on('exit', (code) => {
            channel.appendLine(`Aider exited (code ${code})`);
            chatView.showStatus(`Aider exited (code ${code}).`);
            state.aiderProcess = null;
            updateStatusBar(false);
        });

        updateStatusBar(true);
        vscode.window.showInformationMessage(
            `Aider started (${provider === 'local' ? 'Ollama' : 'Claude API'})`,
        );
    } catch (err) {
        channel.appendLine(`[ERROR] ${(err as Error).message}`);
    }
}

function stopEngine(): void {
    if (!state.aiderProcess) {
        vscode.window.showInformationMessage('Aider is not running.');
        return;
    }

    state.aiderProcess.kill();
    state.aiderProcess = null;

    if (state.activeProvider === 'local') {
        stopOllama();
    }

    if (responseTimer) clearTimeout(responseTimer);
    chatView.markAiDone();
    chatView.showStatus('Engine stopped.');

    updateStatusBar(false);
    vscode.window.showInformationMessage('Aider stopped.');
}

// ── Provider switch ─────────────────────────────────────────────────

async function switchProvider(target?: Provider): Promise<void> {
    const config = cfg();
    const current = config.get<Provider>('provider') ?? 'local';
    const next: Provider = target ?? (current === 'local' ? 'remote' : 'local');

    if (next === current) return;

    if (state.aiderProcess) {
        const answer = await vscode.window.showWarningMessage(
            'Aider is running. Stop it to switch providers?',
            'Stop & Switch',
            'Cancel',
        );
        if (answer !== 'Stop & Switch') {
            chatView.setProvider(current);
            return;
        }
        stopEngine();
    }

    await config.update('provider', next, vscode.ConfigurationTarget.Workspace);

    if (next === 'local') {
        startOllama();
    } else {
        stopOllama();
    }

    state.activeProvider = next;
    updateStatusBar(false);
    chatView.setProvider(next);

    const label = next === 'local' ? 'Local (Ollama)' : 'Remote (Claude API)';
    chatView.showStatus(`Switched to ${label}.`);
    vscode.window.showInformationMessage(`Switched to ${label}.`);
}

// ── Activation / Deactivation ───────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
    chatView = new ChatViewProvider(context.extensionUri, handleChatInput, (action, value) => {
        if (action === 'pickFiles') { pickFiles(); }
        if (action === 'switchProvider' && (value === 'local' || value === 'remote')) {
            switchProvider(value);
        }
    });

    state.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    state.activeProvider = cfg().get<Provider>('provider') ?? 'local';
    updateStatusBar(false);
    state.statusBar.show();
    chatView.setProvider(state.activeProvider);

    out().appendLine('Aider Chat activated.');

    context.subscriptions.push(
        state.statusBar,
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatView),
        vscode.commands.registerCommand('aiderAgent.start', startEngine),
        vscode.commands.registerCommand('aiderAgent.stop', stopEngine),
        vscode.commands.registerCommand('aiderAgent.switchProvider', switchProvider),
        vscode.commands.registerCommand('aiderAgent.addFile', addFile),
        vscode.commands.registerCommand('aiderAgent.removeFile', removeFile),
        vscode.commands.registerCommand('aiderAgent.pickFiles', pickFiles),
    );
}

export function deactivate(): void {
    if (responseTimer) clearTimeout(responseTimer);
    if (state.aiderProcess) {
        state.aiderProcess.kill();
        state.aiderProcess = null;
    }
    if (state.ollamaProcess) {
        state.ollamaProcess.kill();
        state.ollamaProcess = null;
    }
}
