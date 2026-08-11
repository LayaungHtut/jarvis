import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';

const exec = promisify(execFile);

const APP_DETECT: Record<string, (() => Promise<string[]>) | string[]> = {
	vscode: () => Promise.resolve(['code']),
	code: () => Promise.resolve(['code']),
	'visual studio code': () => Promise.resolve(['code']),
	chrome: ['start', 'chrome'],
	'google chrome': ['start', 'chrome'],
	telegram: ['start', ''], // resolved below
	notepad: ['cmd', '/c', 'start', '', 'notepad'],
	terminal: ['cmd', '/c', 'start', '', 'wt'],
	cmd: ['cmd'],
	powershell: ['powershell'],
	explorer: ['explorer'],
	'file explorer': ['explorer'],
	edge: ['start', 'msedge'],
	'microsoft edge': ['start', 'msedge'],
	spotify: ['start', 'spotify'],
	calculator: ['calc'],
	paint: ['mspaint'],
	word: ['winword'],
	excel: ['excel']
};

function isDetector(v: unknown): v is () => Promise<string[]> {
	return typeof v === 'function';
}

const LAUNCH_ALIASES: Record<string, string[]> = {
	chrome: ['chrome'], // explorer start:
	'google chrome': ['chrome'],
	telegram: ['Telegram.exe'],
	edge: ['msedge'],
	'microsoft edge': ['msedge'],
	spotify: ['spotify']
};

async function runCmd(cmd: string, args: string[]): Promise<string> {
	const { stdout, stderr } = await exec(cmd, args, { timeout: 15_000, windowsHide: true });
	return (stdout + stderr).trim();
}

/** Open an installed application by friendly name (Windows via explorer/start or path). */
export class OpenApplicationTool extends Tool {
	name = 'open_application';
	description = 'Open (launch) an installed application such as VS Code, Chrome, Terminal.';
	permissionLevel = 'low' as const;
	parameters = [{ name: 'application', type: 'string', description: 'Friendly app name' }] as const;

	async execute(args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
		const requested = requireString(args, 'application').toLowerCase().trim();
		const detect = APP_DETECT[requested];
		if (!detect) {
			// Try generic Start-Process by name.
			try {
				await runCmd('powershell', [
					'-NoProfile',
					'-Command',
					`Start-Process -FilePath '${requested}'`
				]);
				return ok(`Opened ${requested}`);
			} catch (err) {
				return fail(`Unknown application "${requested}"`, (err as Error).message);
			}
		}

		const candidate = isDetector(detect) ? await detect() : detect;
		try {
			if (process.platform !== 'win32') {
				await runCmd(candidate[0], candidate.slice(1));
			} else if (candidate[0] === 'start') {
				// explorer "ms-uri:" protocol open, or Start-Process
				const uri = candidate[1];
				const alias = LAUNCH_ALIASES[requested];
				if (alias) {
					const proc = await execFile('powershell', [
						'-NoProfile',
						'-Command',
						`Start-Process '${alias[0]}'`
					]);
					if (proc.stderr) void proc.stderr;
					return ok(`Opened ${requested}`);
				}
				void uri;
				await runCmd('cmd', ['/c', 'start', '', requested]);
				return ok(`Opened ${requested}`);
			} else {
				await runCmd(candidate[0], candidate.slice(1));
			}
			return ok(`Opened ${requested}`);
		} catch (err) {
			return fail(`Failed to open ${requested}`, (err as Error).message);
		}
	}
}

/** List visible top-level windows on the current desktop. */
export class ListWindowsTool extends Tool {
	name = 'list_windows';
	description = 'List visible application windows currently open on the desktop.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		try {
			if (process.platform !== 'win32') {
				return fail('list_windows is only supported on Windows.');
			}
			const stdout = await runCmd('powershell', [
				'-NoProfile',
				'-Command',
				`Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json -Compress`
			]);
			const raw = stdout.trim() || '[]';
			let windows: unknown[];
			try {
				const parsed = JSON.parse(raw);
				windows = Array.isArray(parsed) ? parsed : [parsed];
			} catch {
				windows = [];
			}
			const names = (windows as Array<{ ProcessName: string; MainWindowTitle: string | null }>)
				.filter((w) => w && w.ProcessName && w.MainWindowTitle)
				.map((w) => `${w.ProcessName}: ${w.MainWindowTitle}`);
			return names.length
				? ok(`${names.length} window(s) open.`, { windows: names })
				: ok('No visible windows found.', { windows: [] });
		} catch (err) {
			return fail('Failed to list windows', (err as Error).message);
		}
	}
}

/** Fetch the currently focused (front-most) window title. */
export class GetActiveWindowTool extends Tool {
	name = 'get_active_window';
	description = 'Return the title of the currently active window.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		try {
			if (process.platform !== 'win32') {
				return fail('get_active_window is only supported on Windows.');
			}
			const script = [
				'Add-Type @"',
				'using System;',
				'using System.Runtime.InteropServices;',
				'public class Win {',
				'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
				'[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder t, int c);',
				'}',
				'"@;',
				'$h=[Win]::GetForegroundWindow();',
				'$t=New-Object System.Text.StringBuilder 512;',
				'[void][Win]::GetWindowText($h,$t,$t.Capacity);',
				'$t.ToString()'
			].join('\n');
			const title = await runCmd('powershell', ['-NoProfile', '-Command', script]);
			return ok(title.trim() || 'No active window.', { window: title.trim() });
		} catch (err) {
			return fail('Failed to read active window', (err as Error).message);
		}
	}
}
