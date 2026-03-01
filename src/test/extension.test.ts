import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {

	test('Extension is present', () => {
		const ext = vscode.extensions.getExtension('your-name.aider-agent');
		assert.ok(ext, 'Extension your-name.aider-agent not found');
	});

	test('Extension activates without error', async () => {
		const ext = vscode.extensions.getExtension('your-name.aider-agent')!;
		if (!ext.isActive) {
			await ext.activate();
		}
		assert.ok(ext.isActive, 'Extension failed to activate');
	});
});

suite('Command Registration', () => {

	let commands: string[];

	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension('your-name.aider-agent')!;
		if (!ext.isActive) { await ext.activate(); }
		commands = await vscode.commands.getCommands(true);
	});

	test('aiderAgent.start is registered', () => {
		assert.ok(commands.includes('aiderAgent.start'), 'Start command missing');
	});

	test('aiderAgent.stop is registered', () => {
		assert.ok(commands.includes('aiderAgent.stop'), 'Stop command missing');
	});

	test('aiderAgent.switchProvider is registered', () => {
		assert.ok(
			commands.includes('aiderAgent.switchProvider'),
			'Switch provider command missing',
		);
	});

	test('aiderAgent.addFile is registered', () => {
		assert.ok(commands.includes('aiderAgent.addFile'), 'Add file command missing');
	});

	test('aiderAgent.removeFile is registered', () => {
		assert.ok(commands.includes('aiderAgent.removeFile'), 'Remove file command missing');
	});

	test('aiderAgent.pickFiles is registered', () => {
		assert.ok(commands.includes('aiderAgent.pickFiles'), 'Pick files command missing');
	});
});

suite('Configuration Defaults', () => {

	let config: vscode.WorkspaceConfiguration;

	suiteSetup(() => {
		config = vscode.workspace.getConfiguration('aiderAgent');
	});

	test('provider defaults to local', () => {
		const info = config.inspect<string>('provider');
		assert.strictEqual(info?.defaultValue, 'local');
	});

	test('local.model defaults to ollama_chat/qwen2.5-coder:14b', () => {
		const info = config.inspect<string>('local.model');
		assert.strictEqual(info?.defaultValue, 'ollama_chat/qwen2.5-coder:14b');
	});

	test('local.apiBase defaults to http://localhost:11434', () => {
		const info = config.inspect<string>('local.apiBase');
		assert.strictEqual(info?.defaultValue, 'http://localhost:11434');
	});

	test('remote.model defaults to claude-sonnet-4-20250514', () => {
		const info = config.inspect<string>('remote.model');
		assert.strictEqual(info?.defaultValue, 'claude-sonnet-4-20250514');
	});

	test('remote.apiKey defaults to empty string', () => {
		const info = config.inspect<string>('remote.apiKey');
		assert.strictEqual(info?.defaultValue, '');
	});

	test('extraArgs defaults to empty array', () => {
		const info = config.inspect<string[]>('extraArgs');
		assert.deepStrictEqual(info?.defaultValue, []);
	});
});

suite('Engine Safety', () => {

	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension('your-name.aider-agent')!;
		if (!ext.isActive) { await ext.activate(); }
	});

	test('Stop command does not throw when nothing is running', async () => {
		await assert.doesNotReject(
			async () => { await vscode.commands.executeCommand('aiderAgent.stop'); },
		);
	});

	test('Start command does not throw (aider not installed is OK)', async () => {
		await assert.doesNotReject(
			async () => { await vscode.commands.executeCommand('aiderAgent.start'); },
		);
	});
});
