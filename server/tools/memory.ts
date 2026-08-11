import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';

/** Remember a fact or preference for future sessions. */
export class RememberTool extends Tool {
	name = 'remember';
	description = 'Persist a fact, preference or piece of context to long-term memory.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'content', type: 'string', description: 'The fact to remember.' },
		{
			name: 'category',
			type: 'string',
			description:
				'Optional routing category (e.g. identity, work, school, projects, preferences) — chooses which database stores this memory.'
		}
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const content = requireString(args, 'content', 2000);
		const category =
			typeof args.category === 'string' && args.category.trim() ? args.category.trim() : undefined;
		try {
			const entry = await context.memory.remember('fact', content, { tool: 'remember' }, category);
			return ok(`Remembered.`, { id: entry.id, category: entry.category });
		} catch (err) {
			return fail('Failed to store memory.', (err as Error).message);
		}
	}
}

/** Recall stored memories (all kinds), optionally filtered. */
export class RecallTool extends Tool {
	name = 'recall';
	description = 'Recall stored facts, preferences or past task summaries from memory.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'query', type: 'string', description: 'Optional search term to filter recalls.' },
		{ name: 'limit', type: 'number', description: 'Max items to return (default 20).' },
		{
			name: 'category',
			type: 'string',
			description: 'Optional category to restrict recalls to one database.'
		}
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const query = typeof args.query === 'string' ? args.query.trim() : '';
		const limit = Number(args.limit ?? 20);
		const category =
			typeof args.category === 'string' && args.category.trim() ? args.category.trim() : undefined;
		try {
			const entries = query
				? await context.memory.search(query, limit)
				: category
					? await context.memory.recallOpts({ category, limit })
					: await context.memory.recall(undefined, limit);
			const items = entries.map((e) => ({
				id: e.id,
				kind: e.kind,
				category: e.category,
				content: e.content
			}));
			return ok(`${items.length} memory entr${items.length === 1 ? 'y' : 'ies'} recalled.`, {
				items
			});
		} catch (err) {
			return fail('Failed to recall memory.', (err as Error).message);
		}
	}
}

/** Mark N-th item executed as a task completion summary in memory. */
export class RememberTaskTool extends Tool {
	name = 'remember_task';
	description = 'Store a summary of a completed task (JARVIS uses this internally).';
	permissionLevel = 'low' as const;
	parameters = [{ name: 'summary', type: 'string', description: 'Task summary text.' }] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const summary = requireString(args, 'summary', 2000);
		try {
			const entry = await context.memory.remember('task', summary, { task_id: context.taskId });
			return ok('Stored task summary.', { id: entry.id });
		} catch (err) {
			return fail('Failed to store task summary.', (err as Error).message);
		}
	}
}
