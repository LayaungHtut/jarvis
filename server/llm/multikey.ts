export interface OpenRouterKey {
	account: number;
	key: string;
}

const MAX_ACCOUNTS = 4;

/**
 * Collect all configured OpenRouter API keys. Account 1 is stored in
 * OPENROUTER_API_KEY, accounts 2..4 in OPENROUTER_API_KEY_2..4 so a JARVIS
 * instance can draw on multiple OpenRouter accounts (billing/rate limits are
 * independent per key) for the planner/executor/critic/optimizer model chain.
 */
export function openRouterKeys(): OpenRouterKey[] {
	const keys: OpenRouterKey[] = [];
	const push = (account: number, key: string) => {
		if (key.length > 0) keys.push({ account, key });
	};
	push(1, process.env.OPENROUTER_API_KEY ?? '');
	for (let account = 2; account <= MAX_ACCOUNTS; account++) {
		push(account, process.env[`OPENROUTER_API_KEY_${account}`] ?? '');
	}
	return keys;
}

/** Return the key for a specific account, or null when that account is unset. */
export function openRouterKeyFor(account: number): string | null {
	if (account <= 1) {
		const primary = process.env.OPENROUTER_API_KEY ?? '';
		return primary.length > 0 ? primary : null;
	}
	const key = process.env[`OPENROUTER_API_KEY_${account}`] ?? '';
	return key.length > 0 ? key : null;
}

/** Fall back to the first configured account so the chain still works when a role's account is missing. */
export function firstOpenRouterKey(): string | null {
	return openRouterKeys()[0]?.key ?? null;
}

/** Number of configured OpenRouter accounts. */
export function openRouterAccountCount(): number {
	return openRouterKeys().length;
}
