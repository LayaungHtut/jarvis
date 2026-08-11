import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadModels, modelFor, chainRoleFor, resetModels } from './models';

const MODEL_VARS = [
	'JARVIS_MODEL_CONVERSATION',
	'JARVIS_MODEL_PLANNING',
	'JARVIS_MODEL_CODING',
	'JARVIS_MODEL_CODING_PROVIDER',
	'JARVIS_CHAIN_PLANNER_MODEL',
	'JARVIS_CHAIN_PLANNER_ACCOUNT',
	'JARVIS_CHAIN_EXECUTOR_MODEL',
	'JARVIS_CHAIN_EXECUTOR_ACCOUNT',
	'JARVIS_CHAIN_OPTIMIZER_PROVIDER'
] as const;

describe('model config from env', () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of MODEL_VARS) {
			saved.set(key, process.env[key]);
			delete process.env[key];
		}
		resetModels();
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		resetModels();
	});

	it('falls back to defaults when no env is set', () => {
		const models = loadModels();
		expect(models.models.conversation.model).toBe('openai/gpt-4o-mini');
		expect(models.chain.executor.model).toBe('anthropic/claude-3.5-haiku');
		expect(models.chain.executor.account).toBe(2);
	});

	it('overrides category models from env', () => {
		process.env.JARVIS_MODEL_CODING = 'anthropic/claude-3.7-sonnet';
		resetModels();
		expect(modelFor('coding').model).toBe('anthropic/claude-3.7-sonnet');
		expect(modelFor('conversation').model).toBe('openai/gpt-4o-mini');
	});

	it('overrides category provider from env', () => {
		process.env.JARVIS_MODEL_CODING = 'qwen2.5:7b';
		process.env.JARVIS_MODEL_CODING_PROVIDER = 'local';
		resetModels();
		expect(modelFor('coding')).toEqual({ provider: 'local', model: 'qwen2.5:7b' });
	});

	it('overrides chain role model and clamps account to 1..4', () => {
		process.env.JARVIS_CHAIN_PLANNER_MODEL = 'openai/gpt-4.1';
		process.env.JARVIS_CHAIN_PLANNER_ACCOUNT = '9';
		process.env.JARVIS_CHAIN_EXECUTOR_ACCOUNT = '0';
		resetModels();
		expect(chainRoleFor('planner')).toMatchObject({ model: 'openai/gpt-4.1', account: 4 });
		expect(chainRoleFor('executor').account).toBe(1);
	});

	it('overrides chain role provider from env', () => {
		process.env.JARVIS_CHAIN_OPTIMIZER_PROVIDER = 'local';
		resetModels();
		expect(chainRoleFor('optimizer').provider).toBe('local');
	});
});
