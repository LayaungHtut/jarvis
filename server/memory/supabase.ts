import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ClearOptions, MemoryEntry, MemoryStore, RecallOptions } from './store';
import { defaultCategory } from './store';

/**
 * Supabase store backed by the memory table (see migrations/supabase/account-N).
 * Uses the service-role key so RLS is bypassed.
 */
export class SupabaseMemoryStore implements MemoryStore {
	readonly provider = 'supabase' as const;
	readonly id: string;
	private readonly client: SupabaseClient;

	constructor(id: string, url: string, serviceKey: string) {
		this.id = id;
		this.client = createClient(url, serviceKey, { auth: { persistSession: false } });
	}

	async remember(entry: MemoryEntry): Promise<MemoryEntry> {
		const { error } = await this.client.from('memory').insert({
			id: entry.id,
			kind: entry.kind,
			category: entry.category,
			content: entry.content,
			metadata: this.safeJson(entry.metadata),
			created_at: entry.created_at
		});
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return entry;
	}

	async recall(opts?: RecallOptions): Promise<MemoryEntry[]> {
		const limit = Math.max(1, opts?.limit ?? 100);
		let query = this.client.from('memory').select('*').order('created_at', { ascending: false });
		if (opts?.category) query = query.eq('category', opts.category);
		else if (opts?.kind) query = query.eq('kind', opts.kind);
		const { data, error } = await query.limit(limit);
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return (data ?? []).map((r) => this.row(r));
	}

	async search(query: string, limit = 50): Promise<MemoryEntry[]> {
		const { data, error } = await this.client
			.from('memory')
			.select('*')
			.or(`content.ilike.%${escapeLike(query)}%,metadata::text.ilike.%${escapeLike(query)}%`)
			.order('created_at', { ascending: false })
			.limit(limit);
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return (data ?? []).map((r) => this.row(r));
	}

	async forget(id: string): Promise<boolean> {
		const { data, error } = await this.client.from('memory').delete().eq('id', id).select('id');
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return (data ?? []).length > 0;
	}

	async clear(opts?: ClearOptions): Promise<number> {
		let query = this.client.from('memory').delete();
		if (opts?.category) query = query.eq('category', opts.category);
		else if (opts?.kind) query = query.eq('kind', opts.kind);
		const { data, error } = await query.select('id');
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return (data ?? []).length;
	}

	async count(): Promise<number> {
		const { data, error } = await this.client.from('memory').select('id');
		if (error) throw new Error(`[${this.id}] ${error.message}`);
		return (data ?? []).length;
	}

	async ping(): Promise<boolean> {
		const { error } = await this.client.from('memory').select('id').limit(1);
		return !error;
	}

	close(): void {
		// Supabase REST client needs no explicit teardown.
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

	private safeJson(v: string): unknown {
		try {
			return JSON.parse(v);
		} catch {
			return {};
		}
	}
}

function escapeLike(s: string): string {
	return s.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/'/g, "''");
}
