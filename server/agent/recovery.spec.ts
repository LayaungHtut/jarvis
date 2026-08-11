import { describe, it, expect } from 'vitest';
import {
	RecoveryPlanner,
	buildRecoveryPrompt,
	parseRecoverySuggestion,
	type RecoveryInput
} from './recovery';
import type { EnhancedLLMResult } from '../llm/enhanced';

const tools = [
	{ name: 'read_file', description: 'read a file', parameters: {} },
	{ name: 'list_dir', description: 'list directory', parameters: {} },
	{ name: 'write_file', description: 'write a file', parameters: {} }
];
const hasTool = (name: string) => tools.some((t) => t.name === name);

function input(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
	return {
		command: 'read the welcome file',
		tool: 'read_file',
		arguments: { path: 'welcome.txt' },
		description: 'read welcome.txt',
		error: 'ENOENT: no such file',
		priorCalls: [{ tool: 'system_info', result: 'ok' }],
		tools,
		...overrides
	};
}

function result(content: string): EnhancedLLMResult {
	return {
		content,
		tool_calls: [],
		finish_reason: 'stop',
		model: 'stub',
		provider: 'stub'
	};
}

describe('buildRecoveryPrompt', () => {
	it('includes command, failed tool, error, and tool schema', () => {
		const messages = buildRecoveryPrompt(input());
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe('system');
		const user = messages[1].content;
		expect(user).toContain('read the welcome file');
		expect(user).toContain('read_file');
		expect(user).toContain('ENOENT: no such file');
		expect(user).toContain('write_file');
	});

	it('caps the error detail length', () => {
		const longError = 'x'.repeat(5000);
		const messages = buildRecoveryPrompt(input({ error: longError }));
		const user = messages[1].content;
		expect(user.length).toBeLessThan(2000);
	});
});

describe('parseRecoverySuggestion', () => {
	it('parses a retry with corrected arguments', () => {
		const s = parseRecoverySuggestion(
			'{"action":"retry","tool":"read_file","arguments":{"path":"welcome.txt","encoding":"utf8"},"description":"read with encoding","reason":"be explicit"}',
			hasTool
		);
		expect(s?.action).toBe('retry');
		expect(s?.tool).toBe('read_file');
		expect(s?.arguments).toEqual({ path: 'welcome.txt', encoding: 'utf8' });
	});

	it('parses a workaround using a different tool', () => {
		const s = parseRecoverySuggestion(
			'{"action":"workaround","tool":"list_dir","arguments":{"path":"."},"description":"list to find file","reason":"file may be elsewhere"}',
			hasTool
		);
		expect(s?.action).toBe('workaround');
		expect(s?.tool).toBe('list_dir');
	});

	it('parses giveup', () => {
		const s = parseRecoverySuggestion(
			'{"action":"giveup","reason":"no such drive exists"}',
			hasTool
		);
		expect(s?.action).toBe('giveup');
		expect(s?.tool).toBe('');
	});

	it('rejects an unknown tool in retry/workaround', () => {
		expect(
			parseRecoverySuggestion('{"action":"retry","tool":"nonexistent","arguments":{}}', hasTool)
		).toBeNull();
	});

	it('rejects non-JSON and malformed responses', () => {
		expect(parseRecoverySuggestion('hello world', hasTool)).toBeNull();
		expect(parseRecoverySuggestion('{"action":"panic"}', hasTool)).toBeNull();
		expect(parseRecoverySuggestion('not json', hasTool)).toBeNull();
	});

	it('strips fenced code blocks', () => {
		const s = parseRecoverySuggestion(
			'```json\n{"action":"retry","tool":"write_file","arguments":{"path":"a.txt","content":"x"}}\n```',
			hasTool
		);
		expect(s?.action).toBe('retry');
		expect(s?.tool).toBe('write_file');
	});
});

describe('RecoveryPlanner.suggest', () => {
	it('returns the parsed suggestion from the LLM', async () => {
		const llm = {
			continue: async () =>
				result(
					'{"action":"retry","tool":"read_file","arguments":{"path":"README.md"},"reason":"typo"}'
				)
		};
		const planner = new RecoveryPlanner(llm);
		const s = await planner.suggest(input());
		expect(s?.action).toBe('retry');
		expect(s?.tool).toBe('read_file');
	});

	it('returns null when the LLM call fails', async () => {
		const llm = {
			continue: async () => {
				throw new Error('connection refused');
			}
		};
		const planner = new RecoveryPlanner(llm);
		expect(await planner.suggest(input())).toBeNull();
	});
});
