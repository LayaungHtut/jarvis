import { Tool, ok, fail } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';

const WIN32 = `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Wproc {\n[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);\n[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);\n[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);\n}\n"@;`;

/** Match a process by name or window title. */
function decode(
	psJson: string,
	target: string
): Array<{ ProcessName: string; Id: number; MainWindowTitle: string; MainWindowHandle: string }> {
	const needle = target.toLowerCase();
	try {
		const parsed = JSON.parse(psJson);
		const list: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [parsed];
		return list.filter((p) => {
			const name = String(p.ProcessName ?? '').toLowerCase();
			const title = String(p.MainWindowTitle ?? '').toLowerCase();
			return name.includes(needle) || title.includes(needle);
		}) as Array<{
			ProcessName: string;
			Id: number;
			MainWindowTitle: string;
			MainWindowHandle: string;
		}>;
	} catch {
		return [];
	}
}

async function findWindows(target: string): Promise<{
	matches: Array<{
		ProcessName: string;
		Id: number;
		MainWindowTitle: string;
		MainWindowHandle: string;
	}>;
}> {
	const out = await runPs(
		`Get-Process | Where-Object { $_.MainWindowTitle -ne '' -or $_.MainWindowHandle -ne 0 } | Select-Object ProcessName, Id, MainWindowTitle, MainWindowHandle | ConvertTo-Json -Compress`
	);
	return { matches: decode(out, target) };
}

/** List running processes (optionally filtered). */
export class ListProcessesTool extends Tool {
	name = 'list_processes';
	description = 'List running processes, optionally filtered by name.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'filter', type: 'string', description: 'Optional substring to match by name.' },
		{ name: 'limit', type: 'number', description: 'Max rows returned (default 50).' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('list_processes requires Windows.');
		const filter = String(args.filter ?? '');
		const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
		const where = filter
			? `| Where-Object { $_.ProcessName -like '*${filter.replace(/'/g, "''")}*' }`
			: '';
		try {
			const out = await runPs(
				`Get-Process ${where} | Select-Object -First ${limit} ProcessName, Id, CPU, WorkingSet64, MainWindowTitle | ConvertTo-Json -Compress`
			);
			const raw = out || '[]';
			const parsed = JSON.parse(raw);
			const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(
				(p: Record<string, unknown>) => ({
					name: p.ProcessName,
					pid: p.Id,
					cpu: p.CPU,
					memory_mb: Math.round(Number(p.WorkingSet64 ?? 0) / 1024 / 1024),
					window: p.MainWindowTitle ?? ''
				})
			);
			return ok(`${rows.length} process(es).`, { processes: rows.slice(0, limit) });
		} catch (err) {
			return fail('Failed to list processes.', (err as Error).message);
		}
	}
}

/** Kill a process by name substring or PID. */
export class KillProcessTool extends Tool {
	name = 'kill_process';
	description = 'Terminate a process by name substring or numeric PID.';
	permissionLevel = 'critical' as const;
	parameters = [
		{ name: 'target', type: 'string', description: 'Process name substring or PID.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('kill_process requires Windows.');
		const target = String(args.target ?? '').trim();
		if (!target) return fail('Missing target.');

		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { target }
		});
		if (!granted) return fail('Kill was denied by the user.');

		try {
			const isPid = /^\d+$/.test(target);
			const out = await runPs(
				isPid
					? `$p = Get-Process -Id ${target} -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id ${target} -Force -ErrorAction SilentlyContinue; "Killed PID ${target}." } else { "No process with PID ${target}." }`
					: `$p = Get-Process | Where-Object { $_.ProcessName -like '*${target.replace(/'/g, "''")}*' }; if ($p) { $p | Stop-Process -Force -ErrorAction SilentlyContinue; "Killed $($p.Count) process(es) matching ${target}." } else { "No process matched ${target}." }`
			);
			return ok(out || `Killed ${target}.`);
		} catch (err) {
			return fail(`Failed to kill ${target}.`, (err as Error).message);
		}
	}
}

/** Focus/raise a window by matching its title or process name. */
export class FocusWindowTool extends Tool {
	name = 'focus_window';
	description = 'Bring a window to the foreground by matching its title or process name.';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'target', type: 'string', description: 'Window title or process name substring.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('focus_window requires Windows.');
		const target = String(args.target ?? '').trim();
		if (!target) return fail('Missing target.');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { target }
		});
		if (!granted) return fail('Focus was denied by the user.');
		try {
			const { matches } = await findWindows(target);
			const candidates = matches.filter((m) => Number(m.MainWindowHandle) !== 0);
			if (candidates.length === 0)
				return fail(`No window matched "${target}".`, 'window not found');
			const win = candidates[0];
			const h = Number(win.MainWindowHandle);
			const script = `${WIN32}\n$h = [IntPtr]${h}\nif ([Wproc]::IsIconic($h)) { [void][Wproc]::ShowWindow($h, 9) }\n[void][Wproc]::SetForegroundWindow($h)\n"Focused $(${win.ProcessName}): ${win.MainWindowTitle}"`;
			const out = await runPs(script);
			return ok(out || `Focused ${win.ProcessName}.`, {
				process: win.ProcessName,
				title: win.MainWindowTitle
			});
		} catch (err) {
			return fail('Failed to focus window.', (err as Error).message);
		}
	}
}

/** Close a window gracefully (CloseMainWindow). */
export class CloseWindowTool extends Tool {
	name = 'close_window';
	description = 'Request a window to close by matching its title or process name.';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'target', type: 'string', description: 'Window title or process name substring.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('close_window requires Windows.');
		const target = String(args.target ?? '').trim();
		if (!target) return fail('Missing target.');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { target }
		});
		if (!granted) return fail('Close was denied by the user.');
		try {
			const { matches } = await findWindows(target);
			if (matches.length === 0) return fail(`No window matched "${target}".`, 'window not found');
			const script = matches
				.map(
					(m) =>
						`$p = Get-Process -Id ${m.Id} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow(); "Closed ${m.ProcessName} (${m.MainWindowTitle})" }`
				)
				.join('\n');
			const out = await runPs(script);
			return ok(out || `Closed ${target}.`);
		} catch (err) {
			return fail('Failed to close window.', (err as Error).message);
		}
	}
}

/** Minimize a window. */
export class MinimizeWindowTool extends Tool {
	name = 'minimize_window';
	description = 'Minimize a window by matching its title or process name.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'target', type: 'string', description: 'Window title or process name substring.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('minimize_window requires Windows.');
		const target = String(args.target ?? '').trim();
		if (!target) return fail('Missing target.');
		try {
			const { matches } = await findWindows(target);
			const candidates = matches.filter((m) => Number(m.MainWindowHandle) !== 0);
			if (candidates.length === 0)
				return fail(`No window matched "${target}".`, 'window not found');
			const h = Number(candidates[0].MainWindowHandle);
			const out = await runPs(
				`${WIN32}\n[void][Wproc]::ShowWindow([IntPtr]${h}, 6); "Minimized ${candidates[0].ProcessName}"`
			);
			return ok(out || `Minimized ${candidates[0].ProcessName}.`);
		} catch (err) {
			return fail('Failed to minimize window.', (err as Error).message);
		}
	}
}
