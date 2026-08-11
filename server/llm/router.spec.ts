import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Router } from './router';
import { chainRoleFor, modelFor } from '../config/models';

const KEY_VARS = [
	'OPENROUTER_API_KEY',
	'OPENROUTER_API_KEY_2',
	'OPENROUTER_API_KEY_3',
	'OPENROUTER_API_KEY_4'
] as const;

describe('Router multi-account routing', () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of KEY_VARS) {
			saved.set(key, process.env[key]);
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		saved.clear();
	});

	it('counts configured OpenRouter accounts', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		process.env.OPENROUTER_API_KEY_3 = 'k3';
		const router = new Router();
		expect(router.accountCount()).toBe(2);
		expect(router.hasOpenRouter()).toBe(true);
	});

	it('reports 0 accounts and a local provider when no keys are set', () => {
		const router = new Router();
		expect(router.accountCount()).toBe(0);
		expect(router.hasOpenRouter()).toBe(false);
		expect(router.status().provider).toBe('local');
	});

	it('exposes a chain entry per role in status', () => {
		const router = new Router();
		const chain = router.status().chain;
		expect(chain).toHaveLength(4);
		for (const role of ['planner', 'executor', 'critic', 'optimizer']) {
			const entry = chain.find((c) => c.role === role);
			expect(entry).toBeDefined();
			expect(typeof entry?.model).toBe('string');
		}
	});

	it('selects the account configured for each chain role', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		for (let i = 2; i <= 4; i++) process.env[`OPENROUTER_API_KEY_${i}`] = `k${i}`;
		const router = new Router();
		expect(roleAccount(router.roleProvider('planner'))).toBe(1);
		expect(roleAccount(router.roleProvider('executor'))).toBe(2);
		expect(roleAccount(router.roleProvider('critic'))).toBe(3);
		expect(roleAccount(router.roleProvider('optimizer'))).toBe(4);
	});

	it('role providers carry the model from config', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		const router = new Router();
		const provider = router.roleProvider('executor') as unknown as { model: string };
		expect(provider.model).toBe(chainRoleFor('executor').model);
	});

	it('falls back to the first key when a role account is missing', () => {
		process.env.OPENROUTER_API_KEY = 'primary';
		const router = new Router();
		const executor = router.roleProvider('executor') as unknown as { apiKey: string };
		expect(executor.apiKey).toBe('primary');
	});

	it('maps each category to the configured model', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		const router = new Router();
		for (const category of Object.keys(router.models) as (keyof typeof router.models)[]) {
			expect(router.models[category]).toBe(modelFor(category).model);
		}
	});

	it('category providers use account 1 by default', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		const router = new Router();
		const provider = router.providerFor('conversation') as unknown as { account: number };
		expect(provider.account).toBe(1);
	});

	it('caches providers by account:model', () => {
		process.env.OPENROUTER_API_KEY = 'k1';
		const router = new Router();
		const a = router.openRouterFor(1, 'openai/gpt-4o-mini');
		const b = router.openRouterFor(1, 'openai/gpt-4o-mini');
		const c = router.openRouterFor(2, 'openai/gpt-4o-mini');
		expect(a as object).toBe(b as object);
		expect(c as object).not.toBe(a as object);
	});
});

function roleAccount(provider: unknown): number {
	return (provider as { account: number }).account;
}
