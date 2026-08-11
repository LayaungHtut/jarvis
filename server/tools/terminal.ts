import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';

const exec = promisify(execFile);

const SAFE_PREFIXES = [
	'echo',
	'cls',
	'dir',
	'date',
	'time',
	'ver',
	'whoami',
	'node --version',
	'node -v',
	'npm --version',
	'npm -v',
	'git --version',
	'git status',
	'git branch',
	'git log --oneline',
	'npm run build',
	'npm run check',
	'npm test -- --run',
	'npm run lint'
];

const BLOCKED_PATTERNS = [
	/rm\s+-rf/i,
	/rd\s+\/s/i,
	/del\s+\/s/i,
	/format/i,
	/shutdown/i,
	/^\s*(curl|wget)\s+-o\s+/i,
	/sc\s+delete/i,
	/reg\s+delete/i,
	/taskkill\s+\/f/i,
	/start-process\s+.*-\s*verb\s+runas/i
];

/**
 * Command policy that classifies risk before execution. Blocks known
 * destructive commands outright; everything else is reviewed against a
 * safelist and must be permitted by the guardian.
 */
export class CommandPolicy {
	classify(cmd: string): { risk: 'safe' | 'review' | 'blocked'; reason: string } {
		for (const p of BLOCKED_PATTERNS) {
			if (p.test(cmd)) return { risk: 'blocked', reason: `Command matches blocked pattern ${p}` };
		}
		if (SAFE_PREFIXES.some((prefix) => cmd.trim().startsWith(prefix.toLowerCase()))) {
			return { risk: 'safe', reason: 'Command is on the safelist.' };
		}
		return { risk: 'review', reason: 'Command is not on the safelist; manual review required.' };
	}
}

/** Execute a shell command with risk scoring and permission gating. */
export class TerminalTool extends Tool {
	name = 'run_command';
	description = 'Run a shell command in the project workspace and capture its output.';
	permissionLevel = 'medium' as const;
	parameters = [
		{
			name: 'command',
			type: 'string',
			description: 'Shell command to execute (PowerShell on Windows).',
			required: true
		},
		{ name: 'timeout', type: 'number', description: 'Timeout in milliseconds (default 60000).' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const command = requireString(args, 'command', 2000);

		const policy = new CommandPolicy();
		const { risk, reason } = policy.classify(command);

		if (risk === 'blocked') {
			context.log('warn', `Blocked command: ${command}`, this.name);
			return fail('Command blocked by security policy.', reason);
		}
		if (risk === 'review') {
			const granted = await context.requestPermission({
				permission_level: this.permissionLevel,
				tool: this.name,
				arguments: { command }
			});
			if (!granted) return fail('Command was denied by the user.');
		}

		const timeout = Number(args.timeout ?? 60000);
		context.emit('TOOL_STARTED', { tool: this.name, command });
		try {
			const start = Date.now();
			const shell = process.platform === 'win32' ? 'powershell' : '/bin/sh';
			const shellArgs =
				process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
			const { stdout, stderr } = await exec(shell, shellArgs, { timeout, windowsHide: true });
			const duration = Date.now() - start;
			const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
			return ok(
				output ? `Completed in ${duration}ms.` : `Completed in ${duration}ms (no output).`,
				{ stdout: stdout.trim(), stderr: stderr.trim(), duration_ms: duration }
			);
		} catch (err) {
			return fail('Command failed.', (err as Error).message);
		}
	}
}
