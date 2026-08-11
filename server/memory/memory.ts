import type { ClearOptions, MemoryEntry, MemoryKind, MemoryStore, RecallOptions } from './store';
import { defaultCategory } from './store';
import { LocalMemoryStore } from './local';
import { buildMemoryConfig } from './config';
import type { MemoryConfig, Routes } from './config';
import { parseRoutes, routeFor } from './config';

export type { MemoryEntry, MemoryKind, MemoryStore, RecallOptions, ClearOptions };

/**
 * Multi-database memory facade.
 *
 * Writes are routed to the store mapped to the entry's category (see
 * `JARVIS_MEMORY_ROUTES`); reads fan out across every configured store and
 * merge by recency. The local SQLite store is always present as a fallback.
 */
export class Memory {
	private readonly local: LocalMemoryStore;
	private readonly stores = new Map<string, MemoryStore>();
	private readonly routes: Routes;

	constructor(options: { dbPath?: string; config?: MemoryConfig; routes?: Routes } = {}) {
		const cfg = options.config ?? buildMemoryConfig(undefined, options.dbPath);
		this.local = cfg.local;
		for (const store of cfg.cloud) this.stores.set(store.id, store);
		this.stores.set(this.local.id, this.local);
		const parsed = options.routes ?? parseRoutes();
		this.routes = {
			map: parsed.map,
			defaultStore: parsed.defaultStore,
			hasStore: (id) => this.stores.has(id)
		};
	}

	/** All registered stores, local first. */
	allStores(): MemoryStore[] {
		return [this.local, ...this.stores.values()].filter(
			(s, i, arr) => arr.findIndex((x) => x.id === s.id) === i
		);
	}

	async remember(
		kind: MemoryKind,
		content: string,
		metadata: Record<string, unknown> = {},
		category?: string
	): Promise<MemoryEntry> {
		const cat = category ?? defaultCategory(kind);
		const entry: MemoryEntry = {
			id: crypto.randomUUID(),
			kind,
			category: cat,
			content,
			metadata: JSON.stringify(metadata),
			created_at: new Date().toISOString()
		};
		const storeId = routeFor(this.routes, cat);
		const store = this.resolve(storeId);
		await store.remember(entry);
		return entry;
	}

	async recall(kind?: MemoryKind, limit = 100): Promise<MemoryEntry[]> {
		return this.recallOpts({ kind, limit });
	}

	/** Recall with optional category + kind filter, fanning out across stores. */
	async recallOpts(opts?: RecallOptions): Promise<MemoryEntry[]> {
		const results = await Promise.all(
			this.allStores().map((s) => s.recall(opts).catch(() => [] as MemoryEntry[]))
		);
		const merged = results.flat().slice(0, Math.max(1, opts?.limit ?? 100));
		return this.byRecency(merged);
	}

	async search(query: string, limit = 50): Promise<MemoryEntry[]> {
		const results = await Promise.all(
			this.allStores().map((s) => s.search(query, limit).catch(() => [] as MemoryEntry[]))
		);
		const merged = results.flat().slice(0, Math.max(1, limit));
		return this.byRecency(merged);
	}

	async forget(id: string): Promise<boolean> {
		let deleted = false;
		for (const store of this.allStores()) {
			try {
				if (await store.forget(id)) deleted = true;
			} catch {
				// keep trying the other stores
			}
		}
		return deleted;
	}

	async clear(kind?: MemoryKind): Promise<number> {
		return this.clearOpts({ kind });
	}

	async clearOpts(opts?: ClearOptions): Promise<number> {
		const results = await Promise.all(this.allStores().map((s) => s.clear(opts).catch(() => 0)));
		return results.reduce((a, b) => a + b, 0);
	}

	async count(): Promise<number> {
		const results = await Promise.all(this.allStores().map((s) => s.count().catch(() => 0)));
		return results.reduce((a, b) => a + b, 0);
	}

	/** Connectivity report per store, keyed by store id — used for the System panel. */
	async health(): Promise<Record<string, boolean>> {
		const entries = await Promise.all(
			this.allStores().map(async (s) => [s.id, await s.ping().catch(() => false)] as const)
		);
		return Object.fromEntries(entries);
	}

	close(): void {
		for (const store of this.allStores()) {
			try {
				store.close();
			} catch {
				// best effort
			}
		}
	}

	private resolve(storeId: string): MemoryStore {
		return this.stores.get(storeId) ?? this.local;
	}

	private byRecency(entries: MemoryEntry[]): MemoryEntry[] {
		return [...entries].sort((a, b) => b.created_at.localeCompare(a.created_at));
	}
}
