import { describe, it, expect } from 'vitest';
import type { ChainRole } from '../../src/lib/shared/types';
import type { EnhancedLLMRequest, EnhancedLLMResult, ToolDefinition } from './enhanced';
import { ModelChain, buildOutcomeText, type ChainOutcome } from './chain';

const TOOLS: ToolDefinition[] = [
	{ name: 'write_file', description: 'write a file', parameters: {} },
	{ name: 'read_file', description: 'read a file', parameters: {} },
	{ name: 'chat', description: 'chat', parameters: {} }
];

interface FakeRouter {
	continueRole(role: ChainRole, request: EnhancedLLMRequest): Promise<EnhancedLLMResult>;
}

function fakeRouter(
	responses: Partial<Record<ChainRole, string>>,
	emit?: (role: ChainRole, message: string) => void,
	fail?: (role: ChainRole) => boolean
): FakeRouter {
	return {
		async continueRole(role, _request): Promise<EnhancedLLMResult> {
			if (fail?.(role)) throw new Error('boom');
			const content = responses[role] ?? '';
			emit?.(role, content);
			return { content, tool_calls: [], finish_reason: 'stop', model: 'test', provider: 'fake' };
		}
	};
}

describe('buildOutcomeText', () => {
	it('returns a placeholder when there are no outcomes', () => {
		expect(buildOutcomeText([])).toBe('(no steps executed yet)');
	});

	it('formats tool, description and result for each outcome', () => {
		const text = buildOutcomeText([
			{ tool: 'write_file', description: 'write notes', result: 'ok', ok: true }
		]);
		expect(text).toContain('write_file');
		expect(text).toContain('write notes');
		expect(text).toContain(': ok');
	});

	it('marks failed outcomes', () => {
		const text = buildOutcomeText([{ tool: 'open_url', ok: false }]);
		expect(text).toContain(': FAILED');
	});
});

describe('ModelChain.plan', () => {
	it('returns an empty plan when the model replies with no JSON', async () => {
		const chain = new ModelChain(fakeRouter({ planner: 'I am a model, nothing to plan' }));
		expect(await chain.plan('do something', TOOLS)).toEqual([]);
	});

	it('parses a JSON tool call into a single pending plan step', async () => {
		const chain = new ModelChain(
			fakeRouter({
				planner:
					'{"tool":"write_file","arguments":{"path":"a.txt","content":"hi"},"description":"write hi"}'
			})
		);
		const steps = await chain.plan('write a file', TOOLS);
		expect(steps).toHaveLength(1);
		expect(steps[0].tool).toBe('write_file');
		expect(steps[0].args).toEqual({ path: 'a.txt', content: 'hi' });
		expect(steps[0].description).toBe('write hi');
		expect(steps[0].status).toBe('pending');
	});

	it('extracts tool calls from fenced JSON blocks', async () => {
		const chain = new ModelChain(
			fakeRouter({
				planner: '```json\n{"tool":"read_file","arguments":{"path":"package.json"}}\n```'
			})
		);
		const steps = await chain.plan('read the manifest', TOOLS);
		expect(steps[0].tool).toBe('read_file');
		expect(steps[0].args.path).toBe('package.json');
	});
});

describe('ModelChain.completeArgs', () => {
	it('returns refined arguments from the executor model', async () => {
		const chain = new ModelChain(
			fakeRouter({
				executor: '{"arguments":{"path":"notes/a.txt","append":true}}'
			})
		);
		const args = await chain.completeArgs('write notes', { tool: 'write_file' }, TOOLS);
		expect(args).toEqual({ path: 'notes/a.txt', append: true });
	});

	it('returns null when the executor output is not JSON', async () => {
		const chain = new ModelChain(fakeRouter({ executor: 'ok whatever' }));
		expect(await chain.completeArgs('write notes', { tool: 'write_file' }, TOOLS)).toBeNull();
	});
});

describe('ModelChain.critique', () => {
	it('approves when the verdict is approve', async () => {
		const chain = new ModelChain(fakeRouter({ critic: '{"verdict":"approve","issues":[]}' }));
		const critique = await chain.critique({ command: 'do it', outcomes: [], tools: TOOLS });
		expect(critique?.verdict).toBe('approve');
		expect(critique?.issues).toEqual([]);
	});

	it('collects issues for a revise verdict, capping the list', async () => {
		const issues = Array.from({ length: 12 }, (_, i) => `issue ${i}`);
		const chain = new ModelChain(
			fakeRouter({ critic: JSON.stringify({ verdict: 'revise', issues }) })
		);
		const critique = await chain.critique({ command: 'do it', outcomes: [], tools: TOOLS });
		expect(critique?.verdict).toBe('revise');
		expect(critique?.issues).toHaveLength(8);
	});

	it('degrades to a revise verdict with no issues on malformed output', async () => {
		const chain = new ModelChain(fakeRouter({ critic: 'nonsense' }));
		const critique = await chain.critique({ command: 'do it', outcomes: [], tools: TOOLS });
		expect(critique?.verdict).toBe('revise');
		expect(critique?.issues).toEqual([]);
	});
});

describe('ModelChain.optimize', () => {
	it('proposes corrective steps when the tool exists in the schema', async () => {
		const chain = new ModelChain(
			fakeRouter({
				optimizer:
					'{"steps":[{"tool":"write_file","arguments":{"path":"a.txt"},"description":"fix it","reason":"missing content"}]}'
			})
		);
		const steps = await chain.optimize({
			command: 'write a file',
			outcomes: [],
			issues: ['file was empty'],
			tools: TOOLS
		});
		expect(steps).toHaveLength(1);
		expect(steps[0].tool).toBe('write_file');
		expect(steps[0].description).toBe('fix it');
		expect(steps[0].reason).toBe('missing content');
	});

	it('filters out steps that reference unknown tools', async () => {
		const chain = new ModelChain(
			fakeRouter({
				optimizer:
					'{"steps":[{"tool":"nope_not_real","arguments":{}},{"tool":"chat","arguments":{"message":"done"}}]}'
			})
		);
		const steps = await chain.optimize({
			command: 'anything',
			outcomes: [],
			issues: ['x'],
			tools: TOOLS
		});
		expect(steps).toHaveLength(1);
		expect(steps[0].tool).toBe('chat');
	});

	it('caps corrective steps at five', async () => {
		const steps = Array.from({ length: 7 }, (_, i) => ({
			tool: 'chat',
			arguments: { message: `m${i}` },
			description: `d${i}`,
			reason: 'r'
		}));
		const chain = new ModelChain(fakeRouter({ optimizer: JSON.stringify({ steps }) }));
		const corrective = await chain.optimize({
			command: 'anything',
			outcomes: [],
			issues: ['x'],
			tools: TOOLS
		});
		expect(corrective).toHaveLength(5);
	});
});

describe('ModelChain resilience', () => {
	it('emits chain activity for each role invocation', async () => {
		const seen: { role: string; message: string }[] = [];
		const chain = new ModelChain(
			fakeRouter({ planner: '{"tool":"read_file","arguments":{}}' }),
			(role, message) => seen.push({ role, message })
		);
		await chain.plan('read a file', TOOLS);
		expect(seen).toHaveLength(1);
		expect(seen[0].role).toBe('planner');
		expect(seen[0].message).toContain('read_file');
	});

	it('never throws and returns empty results when a role call fails', async () => {
		const seen: string[] = [];
		const chain = new ModelChain(
			fakeRouter({}, undefined, () => true),
			(role, message) => seen.push(message)
		);
		await expect(chain.plan('anything', TOOLS)).resolves.toEqual([]);
		await expect(chain.completeArgs('anything', { tool: 'chat' }, TOOLS)).resolves.toBeNull();
		const critique = await chain.critique({ command: 'x', outcomes: [], tools: TOOLS });
		expect(critique?.verdict).toBe('revise');
		await expect(
			chain.optimize({ command: 'x', outcomes: [], issues: [], tools: TOOLS })
		).resolves.toEqual([]);
		expect(seen.some((m) => m.startsWith('chain unavailable'))).toBe(true);
	});

	it('slices outcomes into a readable log for critic prompts', () => {
		const outcomes: ChainOutcome[] = [
			{ tool: 'open_url', arguments: { url: 'https://example.com' }, result: 'ok', ok: true }
		];
		const text = buildOutcomeText(outcomes);
		expect(text).toContain('https://example.com');
	});
});
