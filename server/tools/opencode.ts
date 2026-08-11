import { spawn } from 'node:child_process';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { OpenCodeManager } from '../opencode/manager';

/**
 * Delegate a coding task to the OpenCode CLI. JARVIS builds a structured
 * prompt (project context, objective, requirements, testing) and monitors the
 * sub-process; events stream back to the HUD.
 */
export class OpenCodeTool extends Tool {
	name = 'opencode';
	description = 'Delegate a coding task to OpenCode in the workspace and monitor progress.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'task', type: 'string', description: 'Objective for the coding task.' },
		{
			name: 'acceptance_tests',
			type: 'string',
			description: 'Tests/build to run as success criteria.'
		}
	] as const;

	private readonly manager = new OpenCodeManager();

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const task = requireString(args, 'task', 5000);
		const acceptance = requireString(args, 'acceptance_tests', 2000);

		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { task: task.slice(0, 80) }
		});
		if (!granted) return fail('OpenCode task was denied by the user.');

		context.emit('OPENCODE_STARTED', { task });
		try {
			const result = await this.manager.run({
				task,
				acceptance_tests: acceptance,
				onLog: (line) => context.emit('OPENCODE_OUTPUT', { line })
			});
			if (result.success) {
				context.emit('TEST_PASSED', { tool: 'opencode' });
				return ok('OpenCode completed the task.', {
					summary: result.output,
					exit_code: result.exitCode
				});
			}
			context.emit('TEST_FAILED', { tool: 'opencode', error: result.error });
			return fail('OpenCode reported failures.', result.error);
		} catch (err) {
			return fail('OpenCode failed to run.', (err as Error).message);
		}
	}
}

/**
 * Tool to check whether the OpenCode CLI is available on this machine. Returns
 * structured info so the agent can plan around it.
 */
export class OpenCodeAvailabilityTool extends Tool {
	name = 'opencode_available';
	description = 'Check whether the OpenCode CLI is installed and usable.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		const manager = new OpenCodeManager();
		const available = await manager.detect();
		return ok(available ? 'OpenCode CLI detected.' : 'OpenCode CLI not found.', {
			installed: available
		});
	}
}

/** Simple spawn helper reused across tools. */
export function runProcess(
	command: string,
	args: string[],
	opts: { cwd?: string; timeoutMs?: number; onData?: (chunk: string) => void } = {}
): Promise<{ code: number | null; output: string; error: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd: opts.cwd, shell: false, windowsHide: true });
		let output = '';
		let error = '';
		const timeout = opts.timeoutMs ?? 120_000;
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			reject(new Error(`Process timed out after ${timeout}ms.`));
		}, timeout);
		child.stdout?.on('data', (chunk: Buffer) => {
			output += chunk.toString();
			opts.onData?.(chunk.toString());
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			error += chunk.toString();
			opts.onData?.(chunk.toString());
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, output, error });
		});
		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}
