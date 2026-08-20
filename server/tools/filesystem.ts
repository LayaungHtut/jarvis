import { readFile, writeFile, readdir, stat, rm, mkdir } from 'node:fs/promises';
import { resolve, join, isAbsolute, relative } from 'node:path';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { EVENT } from '../../src/lib/shared/events';

// Root that filesystem tools are allowed to operate within. Everything outside
// is rejected to keep the agent sandboxed to the project workspace.
export const WORKSPACE_ROOT = process.env.JARVIS_WORKSPACE?.trim() || resolve(process.cwd());

/** Resolve a workspace-relative target and reject paths outside it. */
export function safeResolve(base: string, target: string): string | null {
	const abs = isAbsolute(target) ? resolve(target) : resolve(base, target);
	const normalizedBase = WORKSPACE_ROOT.replace(/\\/g, '/');
	const normalizedAbs = abs.replace(/\\/g, '/');
	if (normalizedAbs === normalizedBase || normalizedAbs.startsWith(normalizedBase + '/')) {
		return abs;
	}
	return null;
}

export class ReadFileTool extends Tool {
	name = 'read_file';
	description = 'Read a file inside the workspace and return its contents.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'path', type: 'string', description: 'Path relative to workspace root.' },
		{ name: 'max_bytes', type: 'number', description: 'Optional cap (default 200 KB).' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const target = requireString(args, 'path');
		const abs = safeResolve(WORKSPACE_ROOT, target);
		if (!abs) return fail('Path is outside the workspace.', 'sandbox violation');
		try {
			const max = Number(args.max_bytes ?? 200_000);
			const st = await stat(abs);
			if (st.size > max) return fail('File is too large to read.', `size=${st.size}`);
			const content = await readFile(abs, 'utf8');
			return ok(`Read ${st.size} bytes.`, { path: relative(WORKSPACE_ROOT, abs), content });
		} catch (err) {
			return fail(`Failed to read ${target}.`, (err as Error).message);
		}
	}
}

export class WriteFileTool extends Tool {
	name = 'write_file';
	description = 'Write content to a file inside the workspace.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'path', type: 'string', description: 'Path relative to workspace root.' },
		{ name: 'content', type: 'string', description: 'File content.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const target = requireString(args, 'path');
		const content = requireString(args, 'content', 500_000);
		const abs = safeResolve(WORKSPACE_ROOT, target);
		if (!abs) return fail('Path is outside the workspace.', 'sandbox violation');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { path: target }
		});
		if (!granted) return fail('Write was denied by the user.');
		try {
			await mkdir(join(abs, '..'), { recursive: true });
			await writeFile(abs, content, 'utf8');
			context.emit(EVENT.FILE_WRITTEN, {
				path: relative(WORKSPACE_ROOT, abs),
				content,
				timestamp: new Date().toISOString()
			});
			return ok(`Wrote ${content.length} chars to ${target}.`, {
				path: relative(WORKSPACE_ROOT, abs)
			});
		} catch (err) {
			return fail(`Failed to write ${target}.`, (err as Error).message);
		}
	}
}

export class ListDirTool extends Tool {
	name = 'list_dir';
	description = 'List files and directories inside a workspace directory.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'path', type: 'string', description: 'Directory path relative to workspace root.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const target = requireString(args, 'path', 2000);
		const abs = safeResolve(WORKSPACE_ROOT, target);
		if (!abs) return fail('Path is outside the workspace.', 'sandbox violation');
		try {
			const entries = await readdir(abs, { withFileTypes: true });
			const items = entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
			return ok(`${items.length} entries.`, { path: target, entries: items });
		} catch (err) {
			return fail(`Failed to list ${target}.`, (err as Error).message);
		}
	}
}

export class DeleteFileTool extends Tool {
	name = 'delete_file';
	description = 'Delete a single file inside the workspace.';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'path', type: 'string', description: 'Path relative to workspace root.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const target = requireString(args, 'path');
		const abs = safeResolve(WORKSPACE_ROOT, target);
		if (!abs) return fail('Path is outside the workspace.', 'sandbox violation');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { path: target }
		});
		if (!granted) return fail('Delete was denied by the user.');
		try {
			const st = await stat(abs);
			if (st.isDirectory()) return fail('Use a designed deletion flow for directories.');
			await rm(abs, { force: true });
			return ok(`Deleted ${target}.`);
		} catch (err) {
			return fail(`Failed to delete ${target}.`, (err as Error).message);
		}
	}
}
