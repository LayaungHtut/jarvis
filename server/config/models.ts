import { load } from 'js-yaml';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChainRole, ModelCategory } from '../../src/lib/shared/types';
import { CHAIN_ROLES } from '../../src/lib/shared/types';

export interface ModelConfig {
	provider: 'openrouter' | 'local';
	model: string;
}

export interface ChainRoleConfig {
	provider: 'openrouter' | 'local';
	/** OpenRouter account number (1..4) this role is billed through. */
	account: number;
	model: string;
}

export type ChainRoles = Record<ChainRole, ChainRoleConfig>;

export interface ModelsConfig {
	models: Record<ModelCategory, ModelConfig>;
	chain: ChainRoles;
}

const CONFIG_PATH = () => resolve(process.cwd(), 'config', 'models.yaml');
const DEFAULT_MODELS: ModelsConfig = {
	models: {
		conversation: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		planning: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		reasoning: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		coding: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		vision: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		summarization: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
		extraction: { provider: 'openrouter', model: 'openai/gpt-4o-mini' }
	},
	chain: {
		planner: { provider: 'openrouter', account: 1, model: 'openai/gpt-4o-mini' },
		executor: { provider: 'openrouter', account: 2, model: 'anthropic/claude-3.5-haiku' },
		critic: { provider: 'openrouter', account: 3, model: 'deepseek/deepseek-chat' },
		optimizer: { provider: 'openrouter', account: 4, model: 'qwen/qwen-2.5-72b-instruct' }
	}
};

let cached: ModelsConfig | null = null;

function parseRoleConfig(raw: unknown): ChainRoleConfig {
	const obj = (raw ?? {}) as Partial<ChainRoleConfig>;
	return {
		provider: obj.provider === 'local' ? 'local' : 'openrouter',
		account: Number.isFinite(Number(obj.account))
			? Math.max(1, Math.min(4, Number(obj.account)))
			: 1,
		model:
			typeof obj.model === 'string' && obj.model.length > 0
				? obj.model
				: DEFAULT_MODELS.models.conversation.model
	};
}

const envStr = (key: string): string | undefined => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

const envNum = (key: string): number | undefined => {
	const value = envStr(key);
	if (value === undefined) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
};

const envProvider = (key: string): 'openrouter' | 'local' | undefined => {
	const value = envStr(key);
	if (value === 'local') return 'local';
	if (value === 'openrouter') return 'openrouter';
	return undefined;
};

/** Model env prefix per category, e.g. `JARVIS_MODEL_CONVERSATION`, `JARVIS_MODEL_CONVERSATION_PROVIDER`. */
const categoryEnv = (category: ModelCategory) => `JARVIS_MODEL_${category.toUpperCase()}`;
/** Chain role env prefix, e.g. `JARVIS_CHAIN_EXECUTOR_MODEL`, `JARVIS_CHAIN_EXECUTOR_ACCOUNT`. */
const roleEnv = (role: ChainRole) => `JARVIS_CHAIN_${role.toUpperCase()}`;

/**
 * Apply model/chain overrides from the environment.
 *
 * Configured in .env (see .env.example):
 * - `JARVIS_MODEL_<CATEGORY>` / `JARVIS_MODEL_<CATEGORY>_PROVIDER`
 * - `JARVIS_CHAIN_<ROLE>_MODEL` / `JARVIS_CHAIN_<ROLE>_ACCOUNT` / `JARVIS_CHAIN_<ROLE>_PROVIDER`
 *
 * Precedence: env > config/models.yaml > built-in defaults.
 */
function applyEnvOverrides(base: ModelsConfig): ModelsConfig {
	const models: Record<ModelCategory, ModelConfig> = { ...base.models };
	for (const category of Object.keys(models) as ModelCategory[]) {
		const model = envStr(categoryEnv(category));
		const provider = envProvider(`${categoryEnv(category)}_PROVIDER`);
		if (model || provider) {
			models[category] = {
				...models[category],
				...(model ? { model } : {}),
				...(provider ? { provider } : {})
			};
		}
	}
	const chain: ChainRoles = { ...base.chain };
	for (const role of CHAIN_ROLES) {
		const model = envStr(`${roleEnv(role)}_MODEL`);
		const account = envNum(`${roleEnv(role)}_ACCOUNT`);
		const provider = envProvider(`${roleEnv(role)}_PROVIDER`);
		if (model || account !== undefined || provider) {
			chain[role] = {
				...chain[role],
				...(model ? { model } : {}),
				...(account !== undefined
					? { account: Math.max(1, Math.min(4, Math.round(account))) }
					: {}),
				...(provider ? { provider } : {})
			};
		}
	}
	return { models, chain };
}

export function loadModels(): ModelsConfig {
	if (cached) return cached;
	let config: ModelsConfig = DEFAULT_MODELS;
	try {
		if (existsSync(CONFIG_PATH())) {
			const raw = readFileSync(CONFIG_PATH(), 'utf8');
			const parsed = load(raw) as Partial<{
				models: Partial<Record<ModelCategory, Partial<ModelConfig>>>;
				chain: Partial<Record<ChainRole, unknown>>;
			}>;
			const models = { ...DEFAULT_MODELS.models };
			for (const category of Object.keys(DEFAULT_MODELS.models) as ModelCategory[]) {
				if (parsed?.models?.[category]) {
					models[category] = { ...models[category], ...parsed.models[category] };
				}
			}
			const chain = { ...DEFAULT_MODELS.chain };
			for (const role of CHAIN_ROLES) {
				if (parsed?.chain?.[role]) {
					chain[role] = parseRoleConfig(parsed.chain[role]);
				}
			}
			config = { models, chain };
		}
	} catch (err) {
		console.warn(`[config] Failed to load models.yaml: ${(err as Error).message}`);
	}
	cached = applyEnvOverrides(config);
	return cached;
}

/** Forget the cached config so env changes take effect (used by tests). */
export function resetModels(): void {
	cached = null;
}

export function modelFor(category: ModelCategory): ModelConfig {
	return loadModels().models[category];
}

export function chainRoleFor(role: ChainRole): ChainRoleConfig {
	return loadModels().chain[role];
}

export function chainSummary(): {
	role: ChainRole;
	provider: string;
	account: number;
	model: string;
}[] {
	return CHAIN_ROLES.map((role) => ({ role, ...chainRoleFor(role) }));
}
