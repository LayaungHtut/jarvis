export type MemoryKind = 'fact' | 'preference' | 'conversation' | 'task' | 'project' | 'general';

export interface MemoryEntry {
	id: string;
	kind: MemoryKind;
	/** Semantic bucket used to route an entry to a specific database store. */
	category: string;
	content: string;
	metadata: string;
	created_at: string;
}

export interface RecallOptions {
	kind?: MemoryKind;
	category?: string;
	limit?: number;
}

export interface ClearOptions {
	kind?: MemoryKind;
	category?: string;
}

/** A single persistence target (local SQLite, a Supabase project, a Neon DB). */
export interface MemoryStore {
	readonly id: string;
	readonly provider: 'local' | 'supabase' | 'neon';
	remember(entry: MemoryEntry): Promise<MemoryEntry>;
	recall(opts?: RecallOptions): Promise<MemoryEntry[]>;
	search(query: string, limit?: number): Promise<MemoryEntry[]>;
	forget(id: string): Promise<boolean>;
	clear(opts?: ClearOptions): Promise<number>;
	count(): Promise<number>;
	/** Lightweight connectivity check. */
	ping(): Promise<boolean>;
	close(): void;
}

/** Default category used when a call does not provide one explicitly. */
export function defaultCategory(kind: MemoryKind): string {
	switch (kind) {
		case 'preference':
			return 'preferences';
		case 'task':
			return 'work';
		case 'project':
			return 'projects';
		default:
			return 'general';
	}
}
