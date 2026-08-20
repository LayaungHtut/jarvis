import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface BrowserSpec {
	name: 'chrome' | 'edge';
	userData: string;
	executable: string[];
}

const BROWSERS: BrowserSpec[] = [
	{
		name: 'chrome',
		userData: join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
		executable: [
			join(
				process.env['ProgramFiles'] ?? 'C:\\Program Files',
				'Google',
				'Chrome',
				'Application',
				'chrome.exe'
			),
			join(
				process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
				'Google',
				'Chrome',
				'Application',
				'chrome.exe'
			),
			join(homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
		]
	},
	{
		name: 'edge',
		userData: join(homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
		executable: [
			join(
				process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
				'Microsoft',
				'Edge',
				'Application',
				'msedge.exe'
			),
			join(
				process.env['ProgramFiles'] ?? 'C:\\Program Files',
				'Microsoft',
				'Edge',
				'Application',
				'msedge.exe'
			)
		]
	}
];

interface AccountProfile {
	browser: string;
	profileDir: string;
	displayName: string;
	email: string;
}

const ACCOUNT_CHOOSER = 'https://accounts.google.com/AccountChooser';

function normalize(text: string): string {
	return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Read a Chrome/Edge profile's Preferences file and extract account identities. */
function profileIdentities(preferencesPath: string): string[] {
	try {
		const raw = JSON.parse(readFileSync(preferencesPath, 'utf8')) as {
			profile?: Record<string, unknown>;
		};
		const profile = raw.profile ?? {};
		const out: string[] = [];
		for (const key of ['name', 'gaia_name']) {
			const v = profile[key];
			if (typeof v === 'string' && v) out.push(v);
		}
		const info = profile.account_info;
		if (Array.isArray(info)) {
			for (const entry of info) {
				const e = entry as Record<string, unknown>;
				if (typeof e.email === 'string' && e.email) out.push(e.email);
				if (typeof e.full_name === 'string' && e.full_name) out.push(e.full_name);
			}
		}
		return out;
	} catch {
		return [];
	}
}

function readdirSafe(dir: string): string[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return [];
	}
}

/** Scan every browser's User Data for a profile whose identity matches the account. */
function findAccountProfile(account: string, preferredBrowser?: string): AccountProfile | null {
	const needle = normalize(account);
	if (!needle) return null;
	const browsers = BROWSERS.filter((b) => !preferredBrowser || b.name === preferredBrowser);
	for (const browser of browsers) {
		if (!existsSync(browser.userData)) continue;
		for (const entry of readdirSafe(browser.userData)) {
			if (entry !== 'Default' && !/^Profile\s*\d+$/.test(entry)) continue;
			const prefsPath = join(browser.userData, entry, 'Preferences');
			if (!existsSync(prefsPath)) continue;
			const identities = profileIdentities(prefsPath);
			const match = identities.find(
				(id) => normalize(id).includes(needle) || needle.includes(normalize(id))
			);
			if (match) {
				return {
					browser: browser.name,
					profileDir: entry,
					displayName: match,
					email: identities.find((id) => id.includes('@')) ?? match
				};
			}
		}
	}
	return null;
}

function resolveBrowserExe(browser: string): string | null {
	const spec = BROWSERS.find((b) => b.name === browser);
	if (!spec) return null;
	return spec.executable.find((p) => existsSync(p)) ?? null;
}

/** Launch the browser executable (with an optional profile) and confirm it started. */
async function launchBrowser(exePath: string, args: string[]): Promise<string> {
	const esc = exePath.replace(/'/g, "''");
	const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(', ');
	const script = `Start-Process -FilePath '${esc}' -ArgumentList ${argList.length ? argList : '@()'}
Start-Sleep -Milliseconds 1200
Write-Output 'STARTED'`;
	const out = await runPs(script, 12_000);
	return out.trim();
}

/**
 * Open a signed-in Google account. Matches the account name/email against the
 * Chrome/Edge profile identities and opens that browser profile; when no match
 * is found it opens Google's account chooser in the default browser.
 */
export class OpenGoogleAccountTool extends Tool {
	name = 'open_google_account';
	description =
		'Open a signed-in Google/Gmail account (e.g. a browser profile for a personal email).';
	permissionLevel = 'low' as const;
	parameters = [
		{
			name: 'account',
			type: 'string',
			description: 'Account name or email (e.g. "shirogami ryuu" or "shirogami.ryuu@gmail.com").'
		},
		{
			name: 'browser',
			type: 'string',
			description: 'Optional browser to use: "chrome" (default) or "edge".'
		}
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const account = requireString(args, 'account', 200);
		const browser = typeof args.browser === 'string' ? args.browser.toLowerCase() : undefined;
		if (browser && browser !== 'chrome' && browser !== 'edge') {
			return fail(`Unsupported browser "${browser}". Use chrome or edge.`);
		}

		if (process.platform === 'win32') {
			const profile = findAccountProfile(account, browser);
			if (profile) {
				const exe = resolveBrowserExe(profile.browser);
				if (exe) {
					await launchBrowser(exe, [
						`--profile-directory=${profile.profileDir}`,
						'https://accounts.google.com'
					]);
					context.emit('TOOL_COMPLETED', { tool: this.name, account, profile: profile.profileDir });
					return ok(
						`Opened Google account "${account}" in ${profile.browser} profile ${profile.profileDir} (${profile.email}).`,
						{ browser: profile.browser, profile: profile.profileDir, email: profile.email }
					);
				}
				return fail(
					`Found profile "${profile.profileDir}" for "${account}" but ${profile.browser} is not installed.`,
					'no browser executable'
				);
			}

			try {
				await launchDefault(ACCOUNT_CHOOSER);
			} catch (err) {
				return fail('Failed to open the Google account chooser.', (err as Error).message);
			}
			return ok(`No saved profile matched "${account}"; opened the Google account chooser.`, {
				chooser: ACCOUNT_CHOOSER,
				matched: false
			});
		}

		try {
			await launchDefault(ACCOUNT_CHOOSER);
			return ok('Opened the Google account chooser.');
		} catch (err) {
			return fail('Failed to open the Google account chooser.', (err as Error).message);
		}
	}
}

/** Open a URL in the OS default browser (Windows or Linux/macOS). */
async function launchDefault(url: string): Promise<void> {
	const { execFile } = await import('node:child_process');
	const { promisify } = await import('node:util');
	const exec = promisify(execFile);
	if (process.platform === 'win32') {
		await exec('cmd', ['/c', 'start', '', url], { windowsHide: true });
	} else {
		await exec('xdg-open', [url], { windowsHide: true });
	}
}
