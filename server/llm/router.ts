import type { LLMRequest, LLMResult } from './base';
import { LLMError } from './base';
import type { EnhancedLLMProvider, EnhancedLLMRequest, EnhancedLLMResult } from './enhanced';
import { OpenRouterProvider } from './openrouter';
import { LocalProvider } from './local';
import { openRouterKeyFor, firstOpenRouterKey, openRouterAccountCount } from './multikey';
import type { ModelCategory, ChainRole } from '../../src/lib/shared/types';
import { CHAIN_ROLES } from '../../src/lib/shared/types';
import { modelFor, chainRoleFor, type ModelConfig, type ChainRoleConfig } from '../config/models';

export interface RouterOptions {
	apiKey?: string;
	forceProvider?: 'openrouter' | 'local';
}

interface CapableProvider extends EnhancedLLMProvider {
	readonly available: boolean;
	generate(request: LLMRequest): Promise<LLMResult>;
}

/**
 * Router selects a provider per task category and per chain role.
 *
 * Multi-account chaining: `config/models.yaml` routes each chain role (planner,
 * executor, critic, optimizer) to an OpenRouter `account` (1..4) whose key lives
 * in OPENROUTER_API_KEY / _2 / _3 / _4. If a role's account key is missing the
 * router falls back to the first configured key so the chain keeps working.
 * When no OpenRouter key exists at all it degrades to the local provider. Never
 * throws configuration errors at construction time so the agent loop can
 * degrade gracefully.
 */
export class Router {
	private readonly local: CapableProvider;
	private readonly orPool = new Map<string, CapableProvider>();
	private readonly options: RouterOptions;
	readonly models: Record<ModelCategory, string>;

	constructor(options: RouterOptions = {}) {
		this.options = options;
		this.local = new LocalProvider() as CapableProvider;

		// Build the visible model map from configuration.
		this.models = {
			conversation: modelFor('conversation').model,
			planning: modelFor('planning').model,
			reasoning: modelFor('reasoning').model,
			coding: modelFor('coding').model,
			vision: modelFor('vision').model,
			summarization: modelFor('summarization').model,
			extraction: modelFor('extraction').model
		};
	}

	/** Number of configured OpenRouter accounts (keys). */
	accountCount(): number {
		return openRouterAccountCount();
	}

	/** Whether we can reach any OpenRouter account. */
	hasOpenRouter(): boolean {
		return openRouterAccountCount() > 0;
	}

	openRouterFor(account: number, model: string): CapableProvider {
		const key = `${account}:${model}`;
		let provider = this.orPool.get(key);
		if (!provider) {
			// Prefer the role's account, fall back to the first available key.
			const apiKey = this.options.apiKey ?? openRouterKeyFor(account) ?? firstOpenRouterKey() ?? '';
			provider = new OpenRouterProvider(model, apiKey, account) as CapableProvider;
			this.orPool.set(key, provider);
		}
		return provider;
	}

	private resolve(cfg: ModelConfig | ChainRoleConfig): CapableProvider {
		const force = cfg.provider === 'local' ? 'local' : cfg.provider;
		if (force === 'local') return this.local;
		if (this.options.forceProvider) {
			const forced =
				this.options.forceProvider === 'openrouter'
					? this.openRouterFor(1, modelFor('conversation').model)
					: this.local;
			if (forced.available) return forced;
		}
		const account = 'account' in cfg ? cfg.account : 1;
		return this.openRouterFor(account, cfg.model);
	}

	providerFor(category: ModelCategory = 'conversation'): CapableProvider {
		return this.resolve(modelFor(category));
	}

	roleProvider(role: ChainRole): CapableProvider {
		return this.resolve(chainRoleFor(role));
	}

	continue(
		request: EnhancedLLMRequest,
		category: ModelCategory = 'conversation'
	): Promise<EnhancedLLMResult> {
		return this.providerFor(category).continue(request);
	}

	async generate(
		request: LLMRequest,
		category: ModelCategory = 'conversation'
	): Promise<LLMResult> {
		return this.providerFor(category).generate(request);
	}

	/** Continue through the model assigned to a chain role (planner/executor/critic/optimizer). */
	continueRole(role: ChainRole, request: EnhancedLLMRequest): Promise<EnhancedLLMResult> {
		return this.roleProvider(role).continue(request);
	}

	status(): {
		provider: string;
		available: boolean;
		localUrl: string | null;
		accounts: number;
		chain: { role: ChainRole; provider: string; account: number; model: string }[];
	} {
		const localUrl = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:11434';
		return {
			provider: this.hasOpenRouter() ? 'openrouter' : 'local',
			available: true,
			localUrl,
			accounts: openRouterAccountCount(),
			chain: CHAIN_ROLES.map((role) => ({ role, ...chainRoleFor(role) }))
		};
	}
}

export { LLMError };
