import type { JarvisEvent } from '../events/bus';
import { EVENT } from '../../src/lib/shared/events';
import { mkdirSync } from 'node:fs';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function safeJson(value: unknown): unknown {
	if (typeof value === 'object' && value !== null) {
		const cleaned: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (
				k.toLowerCase().includes('key') ||
				k.toLowerCase().includes('token') ||
				k.toLowerCase().includes('secret') ||
				k.toLowerCase().includes('password')
			) {
				cleaned[k] = '[redacted]';
			} else {
				cleaned[k] = safeJson(v);
			}
		}
		return cleaned;
	}
	if (Array.isArray(value)) return value.map(safeJson);
	return value;
}

/**
 * Structured audit log — one JSON line per action. Secrets are never written.
 */
export class AuditLog {
	private readonly file: string;

	constructor(logDir = join(process.env.JARVIS_DATA_DIR ?? 'data', 'logs')) {
		this.file = join(logDir, 'audit.ndjson');
		mkdirSync(logDir, { recursive: true });
	}

	private write(entry: Record<string, unknown>): void {
		const clean = safeJson(entry);
		try {
			appendFileSync(this.file, JSON.stringify(clean) + '\n', 'utf8');
		} catch {
			// Last resort fallback — keep the process alive.
		}
	}

	record(ev: JarvisEvent): void {
		this.write({
			event: ev.event,
			task_id: ev.task_id ?? null,
			payload: ev.payload,
			timestamp: ev.timestamp
		});
	}

	/**
	 * Record a tool execution with timing in a structured way for auditing.
	 */
	tool(entry: {
		task_id: string;
		tool: string;
		arguments: unknown;
		permission_level: string;
		duration_ms: number;
		success: boolean;
		error?: string;
	}): void {
		this.write(entry);
	}

	rotate(): void {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		try {
			const current = resolve(this.file);
			writeFileSync(current, '');
			appendFileSync(current.replace(/\.ndjson$/, `-${stamp}.ndjson`), 'rotated\n', 'utf8');
		} catch {
			// ignore rotate failures
		}
	}
}

export function logEvent(
	event: (typeof EVENT)[keyof typeof EVENT],
	tool?: string,
	emoji = ''
): void {
	console.log(`${emoji} ${event}${tool ? ` [${tool}]` : ''}`);
}
