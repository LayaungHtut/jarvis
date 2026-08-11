import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Memory } from '../memory/memory';
import { parseRoutes } from '../memory/config';

const dir = join(tmpdir(), `jarvis-mem-test-${process.pid}`);
let mem: Memory;

afterEach(() => {
	mem?.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('Memory', () => {
	it('remembers and recalls a fact', async () => {
		mem = new Memory({ dbPath: join(dir, 'm.db') });
		await mem.remember('preference', 'user prefers dark theme', { source: 'chat' });
		const rows = await mem.recall('preference');
		expect(rows).toHaveLength(1);
		expect(rows[0].content).toBe('user prefers dark theme');
	});

	it('recall filters by kind', async () => {
		mem = new Memory({ dbPath: join(dir, 'm.db') });
		await mem.remember('fact', 'the sky is blue');
		await mem.remember('task', 'deploy the app');
		expect(await mem.recall('task')).toHaveLength(1);
		expect(await mem.recall()).toHaveLength(2);
	});

	it('searches by content', async () => {
		mem = new Memory({ dbPath: join(dir, 'm.db') });
		await mem.remember('project', 'jarvis workspace is at D:/YOUTHsOrg');
		const hits = await mem.search('jarvis');
		expect(hits).toHaveLength(1);
		expect(await mem.search('nonexistent-phrase')).toHaveLength(0);
	});

	it('forgets and clears', async () => {
		mem = new Memory({ dbPath: join(dir, 'm.db') });
		const a = await mem.remember('fact', 'alpha');
		await mem.remember('fact', 'beta');
		expect(await mem.forget(a.id)).toBe(true);
		expect(await mem.count()).toBe(1);
		expect(await mem.clear('fact')).toBe(1);
		expect(await mem.count()).toBe(0);
	});

	it('routes remember by category to the mapped store', async () => {
		const routed = new Memory({ dbPath: join(dir, 'm.db') });
		try {
			await routed.remember('fact', 'my name is Tony', { tool: 'remember' }, 'identity');
			await routed.remember('fact', 'linear algebra homework', { tool: 'remember' }, 'school');
			const identity = await routed.recallOpts({ category: 'identity' });
			const school = await routed.recallOpts({ category: 'school' });
			expect(identity).toHaveLength(1);
			expect(school).toHaveLength(1);
		} finally {
			routed.close();
		}
	});

	it('health reports local as online', async () => {
		mem = new Memory({ dbPath: join(dir, 'm.db') });
		const health = await mem.health();
		expect(health.local).toBe(true);
	});
});

describe('parseRoutes', () => {
	it('parses category:store pairs', () => {
		const routes = parseRoutes('identity:supabase-1,work:supabase-2,school:neon-1');
		expect(routes.map.get('identity')).toBe('supabase-1');
		expect(routes.map.get('work')).toBe('supabase-2');
		expect(routes.map.get('school')).toBe('neon-1');
		expect(routes.map.get('preferences')).toBeUndefined();
	});
});
