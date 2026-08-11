import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { ClearOptions, MemoryEntry, MemoryStore, RecallOptions } from './store';
import { defaultCategory } from './store';

/**
 * Neon store (Postgres via the official @neondatabase/serverless HTTP driver).
 * Requires the memory table to be migrated first (see migrations/neon/account-N).
 */
export class NeonMemoryStore implements MemoryStore {
	readonly provider = 'neon' as const;
	readonly id: string;
	private readonly sql: NeonQueryFunction<false, false>;

	constructor(id: string, connectionString: string) {
		this.id = id;
		this.sql = neon(connectionString);
	}

	async remember(entry: MemoryEntry): Promise<MemoryEntry> {
		await this.sql`
			INSERT INTO memory (id, kind, category, content, metadata, created_at)
			VALUES (${entry.id}, ${entry.kind}, ${entry.category}, ${entry.content}, ${entry.metadata}::jsonb, ${entry.created_at})
		`;
		return entry;
	}

	async recall(opts?: RecallOptions): Promise<MemoryEntry[]> {
		const limit = Math.max(1, opts?.limit ?? 100);
		const rows = opts?.category
			? await this
					.sql`SELECT * FROM memory WHERE category = ${opts.category} ORDER BY created_at DESC LIMIT ${limit}`
			: opts?.kind
				? await this
						.sql`SELECT * FROM memory WHERE kind = ${opts.kind} ORDER BY created_at DESC LIMIT ${limit}`
				: await this.sql`SELECT * FROM memory ORDER BY created_at DESC LIMIT ${limit}`;
		return rows.map((r) => this.row(r as Record<string, unknown>));
	}

	async search(query: string, limit = 50): Promise<MemoryEntry[]> {
		const like = `%${query}%`;
		const rows = await this
			.sql`SELECT * FROM memory WHERE content ILIKE ${like} OR metadata::text ILIKE ${like} ORDER BY created_at DESC LIMIT ${limit}`;
		return rows.map((r) => this.row(r as Record<string, unknown>));
	}

	async forget(id: string): Promise<boolean> {
		const rows = await this.sql`DELETE FROM memory WHERE id = ${id} RETURNING id`;
		return rows.length > 0;
	}

	async clear(opts?: ClearOptions): Promise<number> {
		const rows = opts?.category
			? await this.sql`DELETE FROM memory WHERE category = ${opts.category} RETURNING id`
			: opts?.kind
				? await this.sql`DELETE FROM memory WHERE kind = ${opts.kind} RETURNING id`
				: await this.sql`DELETE FROM memory RETURNING id`;
		return rows.length;
	}

	async count(): Promise<number> {
		const rows = await this.sql`SELECT COUNT(*)::int AS c FROM memory`;
		return Number((rows[0] as { c: number }).c);
	}

	async ping(): Promise<boolean> {
		try {
			await this.sql`SELECT 1`;
			return true;
		} catch {
			return false;
		}
	}

	close(): void {
		// HTTP driver holds no persistent connection.
	}

	private row(r: Record<string, unknown>): MemoryEntry {
		const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
		return {
			id: str(r.id),
			kind: str(r.kind) as MemoryEntry['kind'],
			category: str(r.category) || defaultCategory(str(r.kind) as MemoryEntry['kind']),
			content: str(r.content),
			metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata ?? {}),
			created_at: str(r.created_at)
		};
	}
}
