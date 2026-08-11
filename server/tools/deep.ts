import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';

function quote(value: string): string {
	return value.replace(/'/g, "''");
}

/** Search the filesystem for files/folders by name pattern (whole user profile). */
export class SearchFilesTool extends Tool {
	name = 'search_files';
	description =
		'Search the filesystem (user profile + all fixed drives) for files/folders by name pattern.';
	permissionLevel = 'medium' as const;
	parameters = [
		{
			name: 'pattern',
			type: 'string',
			description: 'Filename pattern to match, e.g. "report*", "*.pdf", "notes".'
		},
		{
			name: 'location',
			type: 'string',
			description:
				'Root to search (defaults to user profile, e.g. C:\\Users\\USER). Use "drives" for all fixed drives.'
		},
		{
			name: 'limit',
			type: 'number',
			description: 'Maximum results (default 25, max 100).'
		}
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('search_files requires Windows.');
		const pattern = requireString(args, 'pattern', 200);
		const limit = Math.max(1, Math.min(100, Number(args.limit) || 25));
		const location = String(args.location ?? 'profile')
			.trim()
			.toLowerCase();
		const root =
			location === 'drives'
				? `(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\\\$' }).Root`
				: String(args.location ?? '').trim()
					? `'${quote(String(args.location ?? '').trim())}'`
					: `$env:USERPROFILE`;
		const script = `
$roots = ${root}
$hits = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $found = Get-ChildItem -Path $r -Recurse -Filter '${quote(pattern)}' -ErrorAction SilentlyContinue -Depth 6 |
    Where-Object { $_.FullName -notlike '*\\Windows\\*' -and $_.FullName -notlike '*\\node_modules\\*' -and $_.FullName -notlike '*\\AppData\\Local\\Temp\\*' } |
    Select-Object -First ${limit} -ExpandProperty FullName
  $hits += $found
  if ($hits.Count -ge ${limit}) { break }
}
$hits | Select-Object -First ${limit} | ConvertTo-Json -Compress
`;
		try {
			const out = await runPs(script, 90_000);
			const raw = out.trim() || '[]';
			let parsed: unknown[];
			try {
				const json = JSON.parse(raw);
				parsed = Array.isArray(json) ? json : [json];
			} catch {
				parsed = [];
			}
			const paths = parsed.map((p) => String(p)).filter(Boolean);
			return paths.length
				? ok(`${paths.length} file(s) matched "${pattern}".`, { results: paths })
				: ok(`No files matched "${pattern}".`, { results: [] });
		} catch (err) {
			return fail('File search failed.', (err as Error).message);
		}
	}
}

/** Power actions: shutdown, restart, sleep, hibernate, logoff, lock. */
export class SystemPowerTool extends Tool {
	name = 'system_power';
	description = 'Perform a power action: shutdown, restart, sleep, hibernate, logoff, lock.';
	permissionLevel = 'critical' as const;
	parameters = [
		{
			name: 'action',
			type: 'string',
			description: 'shutdown | restart | sleep | hibernate | logoff | lock'
		},
		{ name: 'delay_seconds', type: 'number', description: 'Delay in seconds (default 3).' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('system_power requires Windows.');
		const action = String(args.action ?? '').toLowerCase();
		const delay = Math.max(0, Math.min(300, Number(args.delay_seconds) || 3));
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { action, delay_seconds: delay }
		});
		if (!granted) return fail('Power action was denied by the user.');

		let script: string;
		switch (action) {
			case 'shutdown':
				script = `shutdown.exe /s /t ${delay}`;
				break;
			case 'restart':
				script = `shutdown.exe /r /t ${delay}`;
				break;
			case 'sleep':
				script = `rundll32.exe powrprof.dll,SetSuspendState 0,1,0`;
				break;
			case 'hibernate':
				script = `rundll32.exe powrprof.dll,SetSuspendState 1,0,0`;
				break;
			case 'logoff':
				script = `shutdown.exe /l /t ${delay}`;
				break;
			case 'lock':
				script = `rundll32.exe user32.dll,LockWorkStation`;
				break;
			default:
				return fail(
					`Unknown action "${action}".`,
					'use shutdown | restart | sleep | hibernate | logoff | lock'
				);
		}
		try {
			await runPs(script, 15_000);
			return ok(`Power action "${action}" ${delay ? `in ${delay}s` : 'now'}.`);
		} catch (err) {
			return fail(`Failed to ${action}.`, (err as Error).message);
		}
	}
}

/** List installed applications (registry uninstall keys). */
export class ListAppsTool extends Tool {
	name = 'list_apps';
	description = 'List installed desktop applications (name, version, publisher).';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('list_apps requires Windows.');
		const script = `@(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
) | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
  Where-Object { $_.DisplayName } |
  Select-Object -Unique DisplayName, DisplayVersion, Publisher |
  Sort-Object DisplayName |
  Select-Object -First 150 |
  ConvertTo-Json -Compress`;
		try {
			const out = await runPs(script, 30_000);
			const raw = out.trim() || '[]';
			let parsed: unknown[];
			try {
				const json = JSON.parse(raw);
				parsed = Array.isArray(json) ? json : [json];
			} catch {
				parsed = [];
			}
			const apps = (parsed as Array<Record<string, unknown>>)
				.filter((a) => a && a.DisplayName)
				.map((a) => ({
					name: String(a.DisplayName),
					version: a.DisplayVersion ? String(a.DisplayVersion) : '',
					publisher: a.Publisher ? String(a.Publisher) : ''
				}));
			return apps.length
				? ok(`${apps.length} application(s) installed.`, { apps })
				: ok('No installed applications found.', { apps: [] });
		} catch (err) {
			return fail('Failed to list applications.', (err as Error).message);
		}
	}
}

/** List / start / stop / restart Windows services. */
export class SystemServicesTool extends Tool {
	name = 'system_services';
	description =
		'Manage Windows services: action is list | start | stop | restart, name selects a service.';
	permissionLevel = 'high' as const;
	parameters = [
		{
			name: 'action',
			type: 'string',
			description: 'list | start | stop | restart'
		},
		{
			name: 'name',
			type: 'string',
			description: 'Service name (required for start/stop/restart; optional filter for list).'
		}
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('system_services requires Windows.');
		const action = String(args.action ?? 'list').toLowerCase();
		const name = String(args.name ?? '').trim();

		if (action !== 'list') {
			if (!name) return fail('Missing service name.');
			const granted = await context.requestPermission({
				permission_level: this.permissionLevel,
				tool: this.name,
				arguments: { action, name }
			});
			if (!granted) return fail(`${action} was denied by the user.`);
		}

		try {
			if (action === 'list') {
				const filter = name ? `-Name '*${quote(name)}*'` : '';
				const script = `Get-Service ${filter} -ErrorAction SilentlyContinue | Select-Object -First 60 Name, Status, DisplayName | ConvertTo-Json -Compress`;
				const out = await runPs(script, 20_000);
				const raw = out.trim() || '[]';
				let parsed: unknown[];
				try {
					const json = JSON.parse(raw);
					parsed = Array.isArray(json) ? json : [json];
				} catch {
					parsed = [];
				}
				const services = (parsed as Array<Record<string, unknown>>)
					.filter((s) => s && s.Name)
					.map((s) => ({
						name: String(s.Name),
						status: String(s.Status ?? ''),
						display: s.DisplayName ? String(s.DisplayName) : ''
					}));
				return services.length
					? ok(`${services.length} service(s).`, { services })
					: ok('No services matched.', { services: [] });
			}
			const cmd = `$s = Get-Service -Name '${quote(name)}' -ErrorAction SilentlyContinue; if (-not $s) { 'NOT_FOUND' } else { $s | ${action[0].toUpperCase()}${action.slice(1)}-Service; "OK" }`;
			const out = await runPs(cmd, 30_000);
			if (out.includes('NOT_FOUND')) return fail(`Service "${name}" not found.`, 'not found');
			return ok(`Service "${name}" ${action}ed.`);
		} catch (err) {
			return fail(`Failed to ${action} service.`, (err as Error).message);
		}
	}
}

/** Read an environment variable from the current process. */
export class GetEnvVarTool extends Tool {
	name = 'get_env_var';
	description = 'Read an environment variable value (process scope).';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'name', type: 'string', description: 'Environment variable name.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		const name = requireString(args, 'name', 200);
		const value = process.env[name] ?? '';
		return ok(`Environment variable "${name}" ${value ? `= ${value}` : 'is not set'}.`, {
			name,
			value
		});
	}
}

/** Persist an environment variable for the current user. */
export class SetEnvVarTool extends Tool {
	name = 'set_env_var';
	description = 'Set a persistent user environment variable.';
	permissionLevel = 'critical' as const;
	parameters = [
		{ name: 'name', type: 'string', description: 'Environment variable name.' },
		{ name: 'value', type: 'string', description: 'Value to set (empty deletes it).' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('set_env_var requires Windows.');
		const name = requireString(args, 'name', 200);
		const value = String(args.value ?? '');
		if (value.length > 8000) return fail('Value is too long (max 8000 chars).');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { name, length: value.length }
		});
		if (!granted) return fail('set_env_var was denied by the user.');
		try {
			const script = `[Environment]::SetEnvironmentVariable('${quote(name)}', '${quote(value)}', 'User'); 'OK'`;
			await runPs(script, 15_000);
			return ok(`Environment variable "${name}" set for the current user.`);
		} catch (err) {
			return fail('Failed to set environment variable.', (err as Error).message);
		}
	}
}
