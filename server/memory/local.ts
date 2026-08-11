import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ClearOptions, MemoryEntry, MemoryStore, RecallOptions } from './store';
import { defaultCategory } from './store';

/**
 * Local SQLite store (node:sqlite — no native deps). Always available and used
 * as the fallback when a category has no cloud route configured.
 */
export class LocalMemoryStore implements MemoryStore {
	readonly id = 'local';
	readonly provider = 'local' as const;
	private readonly db: DatabaseSync;

	constructor(dbPath?: string) {
		const path = resolve(dbPath ?? join(process.env.JARVIS_DATA_DIR ?? 'data', 'memory.db'));
		mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS memory (
				id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				category TEXT NOT NULL DEFAULT 'general',
				content TEXT NOT NULL,
				metadata TEXT NOT NULL DEFAULT '{}',
				created_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory(kind);
			CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(created_at);
		`);
		this.migrate();
	}

	/** Add columns introduced after the table was first created (keeps old DB files usable). */
	private migrate(): void {
		const columns = this.db
			.prepare('PRAGMA table_info(memory)')
			.all()
			.map((c) => (c as { name: string }).name);
		if (!columns.includes('category')) {
			this.db.exec(`ALTER TABLE memory ADD COLUMN category TEXT NOT NULL DEFAULT 'general'`);
		}
		this.db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category)`);
	}

	async remember(entry: MemoryEntry): Promise<MemoryEntry> {
		this.db
			.prepare(
				'INSERT INTO memory (id, kind, category, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			)
			.run(entry.id, entry.kind, entry.category, entry.content, entry.metadata, entry.created_at);
		return entry;
	}

	async recall(opts?: RecallOptions): Promise<MemoryEntry[]> {
		const limit = Math.max(1, opts?.limit ?? 100);
		let rows: unknown[];
		if (opts?.category) {
			rows = this.db
				.prepare('SELECT * FROM memory WHERE category = ? ORDER BY created_at DESC LIMIT ?')
				.all(opts.category, limit);
		} else if (opts?.kind) {
			rows = this.db
				.prepare('SELECT * FROM memory WHERE kind = ? ORDER BY created_at DESC LIMIT ?')
				.all(opts.kind, limit);
		} else {
			rows = this.db.prepare('SELECT * FROM memory ORDER BY created_at DESC LIMIT ?').all(limit);
		}
		return rows.map((r) => this.row(r as Record<string, unknown>));
	}

	async search(query: string, limit = 50): Promise<MemoryEntry[]> {
		const like = `%${query}%`;
		const rows = this.db
			.prepare(
				'SELECT * FROM memory WHERE content LIKE ? OR metadata LIKE ? ORDER BY created_at DESC LIMIT ?'
			)
			.all(like, like, limit);
		return rows.map((r) => this.row(r as Record<string, unknown>));
	}

	async forget(id: string): Promise<boolean> {
		const res = this.db.prepare('DELETE FROM memory WHERE id = ?').run(id);
		return Number(res.changes) > 0;
	}

	async clear(opts?: ClearOptions): Promise<number> {
		let res;
		if (opts?.category) {
			res = this.db.prepare('DELETE FROM memory WHERE category = ?').run(opts.category);
		} else if (opts?.kind) {
			res = this.db.prepare('DELETE FROM memory WHERE kind = ?').run(opts.kind);
		} else {
			res = this.db.prepare('DELETE FROM memory').run();
		}
		return Number(res.changes);
	}

	async count(): Promise<number> {
		const row = this.db.prepare('SELECT COUNT(*) AS c FROM memory').get() as { c: number };
		return Number(row.c);
	}

	async ping(): Promise<boolean> {
		try {
			this.db.prepare('SELECT 1').get();
			return true;
		} catch {
			return false;
		}
	}

	close(): void {
		this.db.close();
	}

	private row(r: Record<string, unknown>): MemoryEntry {
		const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));
		return {
			id: str(r.id),
			kind: str(r.kind) as MemoryEntry['kind'],
			category: str(r.category) || defaultCategory(str(r.kind) as MemoryEntry['kind']),
			content: str(r.content),
			metadata: str(r.metadata),
			created_at: str(r.created_at)
		};
	}
}
