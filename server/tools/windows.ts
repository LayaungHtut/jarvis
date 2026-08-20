import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';

const exec = promisify(execFile);

const APP_DETECT: Record<string, (() => Promise<string[]>) | string[]> = {
	vscode: ['start', 'code'],
	code: ['start', 'code'],
	'visual studio code': ['start', 'code'],
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

/** Canonical names of desktop apps the open_application tool knows how to launch. */
export const KNOWN_APP_NAMES: readonly string[] = Object.keys(APP_DETECT);

const LAUNCH_ALIASES: Record<string, string[]> = {
	vscode: ['Code.exe'],
	code: ['Code.exe'],
	'visual studio code': ['Code.exe'],
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

/** Safe bare executable name (e.g. Telegram.exe, chrome) for use inside a PowerShell script. */
function validExeName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9.\-_ ]{0,63}$/.test(name);
}

/** Resolve the absolute path of an executable by name (App Paths registry,
 * Start Menu/Desktop shortcuts, or known install folders). Returns null when
 * no match is found. */
async function resolveExecutable(exeName: string): Promise<string | null> {
	if (!validExeName(exeName)) return null;
	const base = exeName.toLowerCase().endsWith('.exe') ? exeName : `${exeName}.exe`;
	const bare = base.slice(0, -4);
	const script = `$name = '${base}'
$bare = '${bare}'
$result = $null
$reg = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $name,
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $name,
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\' + $name
)
foreach ($p in $reg) {
  $v = Get-ItemProperty -Path $p -ErrorAction SilentlyContinue
  if ($v -and $v.'(default)') { $result = $v.'(default)'; break }
}
if (-not $result) {
  $ws = New-Object -ComObject WScript.Shell
  $dirs = @(
    "$env:USERPROFILE\\Desktop",
    "$env:PUBLIC\\Desktop",
    "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
  )
  foreach ($d in $dirs) {
    $files = Get-ChildItem -Path $d -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue
    foreach ($f in $files) {
      try {
        $t = $ws.CreateShortcut($f.FullName).TargetPath
        if ($t -and ([IO.Path]::GetFileName($t) -eq $name -or [IO.Path]::GetFileNameWithoutExtension($t) -eq $bare)) {
          $result = $t; break
        }
      } catch {}
    }
    if ($result) { break }
  }
}
if ($result) { Write-Output $result }`;
	try {
		const out = await runPs(script, 10_000);
		const hit = out.trim();
		return hit && hit.toLowerCase().endsWith('.exe') ? hit : null;
	} catch {
		return null;
	}
}

/** Launch an executable and poll (up to ~6s) until a process with the given
 * name is actually running. Returns the trimmed PowerShell output. */
async function launchAndVerify(exePath: string, processName: string): Promise<string> {
	const pname = processName.toLowerCase().endsWith('.exe') ? processName.slice(0, -4) : processName;
	const esc = exePath.replace(/'/g, "''");
	const script = `Start-Process -FilePath '${esc}'
$deadline = (Get-Date).AddSeconds(6)
$ok = $false
do {
  if (Get-Process -Name '${pname}' -ErrorAction SilentlyContinue) { $ok = $true; break }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if ($ok) { Write-Output 'STARTED' } else { Write-Output 'NOT_STARTED' }`;
	const out = await runPs(script, 12_000);
	return out.trim();
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
					const exe = (await resolveExecutable(alias[0])) ?? alias[0];
					const out = await launchAndVerify(exe, alias[0]);
					if (out !== 'STARTED') {
						return fail(
							`Failed to open ${requested}: process "${alias[0]}" did not start.`,
							'launch not verified'
						);
					}
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
