import * as assert from 'assert';
import * as vscode from 'vscode';
import { ChatViewProvider } from '../chatViewProvider.js';

// Minimal mock that satisfies the WebviewView contract enough for unit tests
function createMockWebviewView() {
	const posted: Array<{ type: string; text?: string }> = [];
	const receiveHandlers: Array<(msg: any) => void> = [];

	const webview = {
		options: {} as vscode.WebviewOptions,
		html: '',
		cspSource: 'https://test.vscode-resource.vscode-cdn.net',
		postMessage(msg: any) {
			posted.push(msg);
			return Promise.resolve(true);
		},
		onDidReceiveMessage(handler: (msg: any) => void) {
			receiveHandlers.push(handler);
			return { dispose() { /* noop */ } };
		},
		asWebviewUri(uri: vscode.Uri) { return uri; },
	};

	const emitter = new vscode.EventEmitter<void>();

	const view = {
		webview,
		viewType: ChatViewProvider.viewType,
		title: undefined as string | undefined,
		description: undefined as string | undefined,
		badge: undefined,
		visible: true,
		onDidChangeVisibility: emitter.event,
		onDidDispose: emitter.event,
		show() { /* noop */ },
	} as unknown as vscode.WebviewView;

	return { view, posted, receiveHandlers, webview };
}

suite('ChatViewProvider — Static', () => {

	test('viewType matches package.json contribution', () => {
		assert.strictEqual(ChatViewProvider.viewType, 'aiderAgent.chatView');
	});
});

suite('ChatViewProvider — Before resolveWebviewView', () => {

	test('Can be instantiated with a send handler', () => {
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
		assert.ok(provider instanceof ChatViewProvider);
	});

	test('Public methods do not throw before view resolves', () => {
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
		assert.doesNotThrow(() => provider.addUserMessage('hello'));
		assert.doesNotThrow(() => provider.appendAiChunk('chunk'));
		assert.doesNotThrow(() => provider.markAiDone());
		assert.doesNotThrow(() => provider.showStatus('status'));
		assert.doesNotThrow(() => provider.clear());
	});
});

suite('ChatViewProvider — After resolveWebviewView', () => {

	let provider: ChatViewProvider;
	let mock: ReturnType<typeof createMockWebviewView>;

	setup(() => {
		mock = createMockWebviewView();
		provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
	});

	test('resolveWebviewView sets HTML on the webview', () => {
		provider.resolveWebviewView(mock.view);
		assert.ok(mock.webview.html.length > 0, 'HTML was not set');
	});

	test('HTML contains essential elements', () => {
		provider.resolveWebviewView(mock.view);
		const html = mock.webview.html;
		assert.ok(html.includes('<textarea'), 'Missing textarea input');
		assert.ok(html.includes('send-btn'), 'Missing send button');
		assert.ok(html.includes('Content-Security-Policy'), 'Missing CSP meta');
		assert.ok(html.includes('nonce-'), 'Missing script nonce');
		assert.ok(html.includes('messages'), 'Missing messages container');
	});

	test('HTML enables scripts via webview options', () => {
		provider.resolveWebviewView(mock.view);
		assert.strictEqual(mock.webview.options.enableScripts, true);
	});

	test('Pending messages are flushed on resolve', () => {
		provider.addUserMessage('queued-msg');
		provider.showStatus('queued-status');

		assert.strictEqual(mock.posted.length, 0, 'Messages posted before resolve');

		provider.resolveWebviewView(mock.view);

		assert.strictEqual(mock.posted.length, 2, 'Pending messages not flushed');
		assert.strictEqual(mock.posted[0].type, 'userMessage');
		assert.strictEqual(mock.posted[0].text, 'queued-msg');
		assert.strictEqual(mock.posted[1].type, 'status');
		assert.strictEqual(mock.posted[1].text, 'queued-status');
	});

	test('Messages post directly after view is resolved', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.appendAiChunk('live-chunk');

		assert.strictEqual(mock.posted.length, 1);
		assert.strictEqual(mock.posted[0].type, 'aiChunk');
		assert.strictEqual(mock.posted[0].text, 'live-chunk');
	});

	test('addUserMessage posts correct message shape', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.addUserMessage('hello world');

		assert.deepStrictEqual(mock.posted[0], {
			type: 'userMessage',
			text: 'hello world',
		});
	});

	test('appendAiChunk posts correct message shape', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.appendAiChunk('some output');

		assert.deepStrictEqual(mock.posted[0], {
			type: 'aiChunk',
			text: 'some output',
		});
	});

	test('markAiDone posts correct message shape', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.markAiDone();

		assert.deepStrictEqual(mock.posted[0], { type: 'aiDone' });
	});

	test('showStatus posts correct message shape', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.showStatus('Engine started');

		assert.deepStrictEqual(mock.posted[0], {
			type: 'status',
			text: 'Engine started',
		});
	});

	test('clear posts correct message shape', () => {
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.clear();

		assert.deepStrictEqual(mock.posted[0], { type: 'clear' });
	});
});

suite('ChatViewProvider — Send Handler', () => {

	test('onSend callback is invoked when webview posts a send command', () => {
		const sent: string[] = [];
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			(text) => { sent.push(text); },
		);

		provider.resolveWebviewView(mock.view);

		assert.strictEqual(mock.receiveHandlers.length, 1, 'No receive handler registered');
		mock.receiveHandlers[0]({ command: 'send', text: 'fix the bug' });

		assert.strictEqual(sent.length, 1);
		assert.strictEqual(sent[0], 'fix the bug');
	});

	test('Non-send commands are ignored by send handler', () => {
		const sent: string[] = [];
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			(text) => { sent.push(text); },
		);

		provider.resolveWebviewView(mock.view);
		mock.receiveHandlers[0]({ command: 'other', text: 'ignored' });

		assert.strictEqual(sent.length, 0, 'Handler should not fire for non-send commands');
	});

	test('Action callback is invoked for action commands', () => {
		const actions: string[] = [];
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
			(action) => { actions.push(action); },
		);

		provider.resolveWebviewView(mock.view);
		mock.receiveHandlers[0]({ command: 'action', action: 'pickFiles' });

		assert.strictEqual(actions.length, 1);
		assert.strictEqual(actions[0], 'pickFiles');
	});

	test('Action callback receives value for switchProvider', () => {
		const received: Array<{ action: string; value?: string }> = [];
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
			(action, value) => { received.push({ action, value }); },
		);

		provider.resolveWebviewView(mock.view);
		mock.receiveHandlers[0]({ command: 'action', action: 'switchProvider', value: 'remote' });

		assert.strictEqual(received.length, 1);
		assert.strictEqual(received[0].action, 'switchProvider');
		assert.strictEqual(received[0].value, 'remote');
	});
});

suite('ChatViewProvider — Attach Button', () => {

	test('HTML contains the attach button', () => {
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
		provider.resolveWebviewView(mock.view);

		assert.ok(mock.webview.html.includes('attach-btn'), 'Missing attach button');
	});
});

suite('ChatViewProvider — Provider Dropdown', () => {

	test('HTML contains the provider dropdown', () => {
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
		provider.resolveWebviewView(mock.view);

		assert.ok(mock.webview.html.includes('provider-select'), 'Missing provider dropdown');
		assert.ok(mock.webview.html.includes('Driven by:'), 'Missing dropdown label');
		assert.ok(mock.webview.html.includes('Local (Ollama)'), 'Missing local option');
		assert.ok(mock.webview.html.includes('Remote (Claude API)'), 'Missing remote option');
	});

	test('setProvider posts correct message shape', () => {
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);
		provider.resolveWebviewView(mock.view);
		mock.posted.length = 0;

		provider.setProvider('remote');

		assert.deepStrictEqual(mock.posted[0], {
			type: 'provider',
			text: 'remote',
		});
	});

	test('setProvider queues message before view resolves', () => {
		const mock = createMockWebviewView();
		const provider = new ChatViewProvider(
			vscode.Uri.file('/tmp'),
			() => { /* noop */ },
		);

		provider.setProvider('local');
		assert.strictEqual(mock.posted.length, 0, 'Should not post before resolve');

		provider.resolveWebviewView(mock.view);
		const providerMsg = mock.posted.find((m) => m.type === 'provider');
		assert.ok(providerMsg, 'Provider message not flushed on resolve');
		assert.strictEqual(providerMsg!.text, 'local');
	});
});
