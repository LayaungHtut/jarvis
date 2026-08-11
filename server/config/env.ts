import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader. Vite already loads .env for the frontend; this covers
 * the standalone backend process which doesn't go through Vite.
 */
export function loadEnv(envPath = '.env'): void {
	const file = resolve(process.cwd(), envPath);
	if (!existsSync(file)) return;
	const lines = readFileSync(file, 'utf8').split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
		if (!(key in process.env)) process.env[key] = value;
	}
}
