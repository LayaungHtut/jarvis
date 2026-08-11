import type { MemoryStore } from './store';
import { LocalMemoryStore } from './local';
import { SupabaseMemoryStore } from './supabase';
import { NeonMemoryStore } from './neon';

export interface MemoryConfig {
	/** Always-present fallback store. */
	local: LocalMemoryStore;
	/** Extra configured cloud stores, keyed by store id. */
	cloud: MemoryStore[];
}

const num = (s: string | undefined): number | undefined =>
	s === undefined ? undefined : Number(s);

/**
 * Build memory stores from the environment.
 *
 * Stores are registered under ids:
 * - `local`
 * - `supabase-1` / `supabase-2`
 * - `neon-1` / `neon-2`
 */
export function buildMemoryConfig(env = process.env, dbPath?: string): MemoryConfig {
	const local = new LocalMemoryStore(dbPath);
	const cloud: MemoryStore[] = [];

	for (let i = 1; i <= 2; i++) {
		const url = env[`SUPABASE_URL_${i}`];
		const key = env[`SUPABASE_SERVICE_ROLE_KEY_${i}`] ?? env[`SUPABASE_KEY_${i}`];
		if (url && key) cloud.push(new SupabaseMemoryStore(`supabase-${i}`, url, key));

		const dbUrl = env[`NEON_DATABASE_URL_${i}`];
		if (dbUrl) cloud.push(new NeonMemoryStore(`neon-${i}`, dbUrl));
	}

	return { local, cloud };
}

export interface Routes {
	/** category -> store id (e.g. 'identity' -> 'supabase-1'). */
	map: Map<string, string>;
	/** categories left unassigned fall back to the local store. */
	defaultStore: string;
	/** Returns true when the store id maps to a configured store. */
	hasStore: (id: string) => boolean;
}

/**
 * Route categories to databases.
 *
 * Reads `JARVIS_MEMORY_ROUTES` in the form:
 *   identity:supabase-1,work:supabase-2,school:neon-1,preferences:neon-2
 *
 * Unlisted categories go to `defaultStore`.
 */
export function parseRoutes(
	raw = process.env.JARVIS_MEMORY_ROUTES
): Pick<Routes, 'map' | 'defaultStore'> {
	const map = new Map<string, string>();
	if (raw) {
		for (const pair of raw.split(',')) {
			const [category, storeId] = pair.split(':').map((s) => s.trim());
			if (category && storeId) map.set(category, storeId);
		}
	}
	return { map, defaultStore: 'local' };
}

/** Attach the store-existence checker and resolve the store for a category. */
export function routeFor(routes: Routes, category: string): string {
	const id = routes.map.get(category);
	if (id && routes.hasStore(id)) return id;
	return routes.defaultStore;
}

/** 1-based counts of configured supabase / neon accounts. */
export function accountCounts(env = process.env): { supabase: number; neon: number } {
	const supabase =
		num(env.SUPABASE_ACCOUNT_COUNT) ??
		([1, 2].filter((i) => env[`SUPABASE_URL_${i}`]).length as number);
	const neon =
		num(env.NEON_ACCOUNT_COUNT) ??
		([1, 2].filter((i) => env[`NEON_DATABASE_URL_${i}`]).length as number);
	return { supabase, neon };
}
