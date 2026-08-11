import { copyFile as fsCopy, rename, mkdir, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import { WORKSPACE_ROOT, safeResolve } from './filesystem';
import { runPs } from './ps';

/** Read text from the system clipboard. */
export class ClipboardReadTool extends Tool {
	name = 'clipboard_read';
	description = 'Read the current text from the system clipboard.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('clipboard_read requires Windows.');
		try {
			const out = await runPs(`Get-Clipboard -Raw -ErrorAction SilentlyContinue`);
			return ok('Read clipboard.', { text: out });
		} catch (err) {
			return fail('Failed to read clipboard.', (err as Error).message);
		}
	}
}

/** Write text to the system clipboard. */
export class ClipboardWriteTool extends Tool {
	name = 'clipboard_write';
	description = 'Copy text to the system clipboard.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'text', type: 'string', description: 'Text to copy to the clipboard.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('clipboard_write requires Windows.');
		const text = requireString(args, 'text', 4_000_000);
		const escaped = text.split('\x00').join('').replace(/'/g, "''");
		try {
			await runPs(`Set-Clipboard -Value @'\n${escaped}\n'@`, 20_000);
			return ok(`Copied ${text.length} characters to the clipboard.`);
		} catch (err) {
			return fail('Failed to write clipboard.', (err as Error).message);
		}
	}
}

function resolveTarget(
	args: Record<string, unknown>,
	sourceKey = 'source',
	destKey = 'destination'
): { src: string; dest: string } | { error: string } {
	try {
		const src = requireString(args, sourceKey);
		const dest = requireString(args, destKey);
		const srcAbs = safeResolve(WORKSPACE_ROOT, src);
		if (!srcAbs) return { error: 'Source is outside the workspace.' };
		const destAbs = safeResolve(WORKSPACE_ROOT, dest);
		if (!destAbs) return { error: 'Destination is outside the workspace.' };
		return { src: srcAbs, dest: destAbs };
	} catch (err) {
		return { error: (err as Error).message };
	}
}

/** Copy a file within the workspace. */
export class CopyFileTool extends Tool {
	name = 'copy_file';
	description = 'Copy a file inside the workspace to a new path.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'source', type: 'string', description: 'Relative source path.' },
		{ name: 'destination', type: 'string', description: 'Relative destination path.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('copy_file requires Windows.');
		const r = resolveTarget(args);
		if ('error' in r) return fail(r.error);
		try {
			const st = await stat(r.src);
			if (st.isDirectory()) return fail('copy_file copies a single file.');
			await mkdir(r.dest.slice(0, r.dest.lastIndexOf('\\')), { recursive: true });
			await fsCopy(r.src, r.dest);
			return ok(
				`Copied ${relative(WORKSPACE_ROOT, r.src)} -> ${relative(WORKSPACE_ROOT, r.dest)}.`
			);
		} catch (err) {
			return fail('Failed to copy file.', (err as Error).message);
		}
	}
}

/** Move/rename a file within the workspace. */
export class MoveFileTool extends Tool {
	name = 'move_file';
	description = 'Move or rename a file inside the workspace.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'source', type: 'string', description: 'Relative source path.' },
		{ name: 'destination', type: 'string', description: 'Relative destination path.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('move_file requires Windows.');
		const r = resolveTarget(args);
		if ('error' in r) return fail(r.error);
		try {
			await mkdir(r.dest.slice(0, r.dest.lastIndexOf('\\')), { recursive: true });
			await rename(r.src, r.dest);
			return ok(`Moved ${relative(WORKSPACE_ROOT, r.src)} -> ${relative(WORKSPACE_ROOT, r.dest)}.`);
		} catch (err) {
			return fail('Failed to move file.', (err as Error).message);
		}
	}
}

/** Zip a folder (or file) inside the workspace into an archive. */
export class ZipFolderTool extends Tool {
	name = 'zip_folder';
	description = 'Create a zip archive of a workspace folder or file.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'source', type: 'string', description: 'Relative folder or file path.' },
		{ name: 'archive', type: 'string', description: 'Relative output .zip path (e.g. backup.zip).' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('zip_folder requires Windows.');
		const r = resolveTarget(args, 'source', 'archive');
		if ('error' in r) return fail(r.error);
		try {
			const st = await stat(r.src);
			if (!st.isDirectory()) return fail('zip_folder archives a folder.');
			const script = `Compress-Archive -Path '${r.src.replace(/'/g, "''")}\\*' -DestinationPath '${r.dest.replace(/'/g, "''")}' -Force`;
			await runPs(script, 60_000);
			return ok(`Created archive ${relative(WORKSPACE_ROOT, r.dest)}.`);
		} catch (err) {
			return fail('Failed to create archive.', (err as Error).message);
		}
	}
}

/** Open a workspace file/folder with its default application or explorer. */
export class OpenPathTool extends Tool {
	name = 'open_path';
	description = 'Open a workspace file or folder with the default app (or explorer).';
	permissionLevel = 'medium' as const;
	parameters = [{ name: 'path', type: 'string', description: 'Relative path to open.' }] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('open_path requires Windows.');
		const target = requireString(args, 'path');
		const abs = safeResolve(WORKSPACE_ROOT, target);
		if (!abs) return fail('Path is outside the workspace.', 'sandbox violation');
		try {
			await runPs(`Start-Process -FilePath '${abs.replace(/'/g, "''")}'`);
			return ok(`Opened ${target}.`);
		} catch (err) {
			return fail('Failed to open path.', (err as Error).message);
		}
	}
}
