import { runProcess } from '../tools/opencode';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface OpenCodeRunOptions {
	task: string;
	acceptance_tests: string;
	cwd?: string;
	onLog?: (line: string) => void;
}

export interface OpenCodeRunResult {
	success: boolean;
	output: string;
	error: string;
	exitCode: number | null;
}

const PROMPT_TEMPLATE = (task: string, tests: string) => `## Project context
You are working inside a SvelteKit + TypeScript project. Preserve existing functionality.

## Objective
${task}

## Testing requirements
Run and keep passing:
- ${tests}

## Constraints
- Do not invent dependencies unless required.
- Keep changes minimal and focused on the objective.
- Do not push to remote repositories.

## Success criteria
- No TypeScript errors.
- Provided testing commands pass.
- Existing routes continue working.`;

/**
 * Thin wrapper around the OpenCode CLI ('opencode run'). JARVIS composes a
 * structured prompt, streams sub-process output to the HUD and returns the
 * final transcript. Falls back to a clear diagnostic when the CLI is missing.
 */
export class OpenCodeManager {
	async detect(): Promise<boolean> {
		try {
			const { code } = await runProcess('opencode', ['--version'], { timeoutMs: 8000 });
			return code === 0;
		} catch {
			return false;
		}
	}

	async run(options: OpenCodeRunOptions): Promise<OpenCodeRunResult> {
		const cwd = options.cwd ?? process.env.JARVIS_WORKSPACE ?? resolve(process.cwd());

		if (!(await this.detect())) {
			return {
				success: false,
				output: '',
				error: 'OpenCode CLI is not installed (run: npm i -g opencode-ai).',
				exitCode: 1
			};
		}

		const prompt = PROMPT_TEMPLATE(options.task, options.acceptance_tests);

		try {
			const result = await runProcess('opencode', ['run', prompt, '--print-timing'], {
				cwd,
				timeoutMs: 0,
				onData: options.onLog
			});
			return {
				success: result.code === 0,
				output: result.output,
				error: result.error,
				exitCode: result.code
			};
		} catch (err) {
			return { success: false, output: '', error: (err as Error).message, exitCode: -1 };
		}
	}
}

export async function buildCorrectionTask(
	failingOutput: string,
	userRequest: string,
	previousPrompt: string,
	attempt: number
): Promise<string> {
	const file = resolve(process.cwd(), 'data', 'tasks', `correction-${attempt}-${Date.now()}.md`);
	const body = `## Original request\n${userRequest}\n\n## Previous prompt\n${previousPrompt}\n\n## Observed failure (attempt ${attempt})\n\`\`\`\n${failingOutput.slice(0, 4000)}\n\`\`\`\n\nFix the reported issue without regressing the tests listed above.`;
	await mkdir(resolve(file, '..'), { recursive: true });
	await writeFile(file, body, 'utf8');
	return body;
}
