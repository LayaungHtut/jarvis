import { describe, it, expect } from 'vitest';
import { parseInterpretation } from './interpreter';
import type { ToolDefinition } from '../llm/enhanced';

const TOOLS: ToolDefinition[] = [
	{ name: 'open_google_account', description: 'Open a signed-in Google account', parameters: {} },
	{ name: 'open_application', description: 'Open an installed application', parameters: {} },
	{ name: 'open_url', description: 'Open a URL', parameters: {} },
	{ name: 'search_web', description: 'Search the web', parameters: {} },
	{ name: 'chat', description: 'Conversational reply', parameters: {} }
];

describe('parseInterpretation', () => {
	it('parses a single-step interpretation', () => {
		const result = parseInterpretation(
			'```json\n{"reasoning":"it is a google account","steps":[{"tool":"open_google_account","arguments":{"account":"shirogami ryuu"},"description":"Open Google account"}]}\n```',
			TOOLS
		);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0].tool).toBe('open_google_account');
		expect(result.steps[0].args.account).toBe('shirogami ryuu');
		expect(result.reasoning).toBe('it is a google account');
	});

	it('returns empty steps for conversational requests', () => {
		const result = parseInterpretation('{"reasoning":"no tool needed","steps":[]}', TOOLS);
		expect(result.steps).toHaveLength(0);
		expect(result.reasoning).toBe('no tool needed');
	});

	it('drops steps that use unknown tools or malformed arguments', () => {
		const result = parseInterpretation(
			JSON.stringify({
				reasoning: 'mixed',
				steps: [
					{ tool: 'open_google_account', arguments: { account: 'x' }, description: 'ok' },
					{ tool: 'totally_fake', arguments: {}, description: 'not in schema' },
					{ tool: 'chat', arguments: 'not-an-object', description: 'bad args' }
				]
			}),
			TOOLS
		);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0].tool).toBe('open_google_account');
	});

	it('returns empty on invalid JSON', () => {
		const result = parseInterpretation('not json at all', TOOLS);
		expect(result.steps).toHaveLength(0);
		expect(result.reasoning).toBe('');
	});
});
