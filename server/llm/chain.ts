import type { Router } from './router';
import type { ToolDefinition } from './enhanced';
import type { LLMChatMessage } from './base';
import type { ChainRole, PlanStep } from '../../src/lib/shared/types';
import { randomUUID } from 'node:crypto';
import { extractJson } from './local';

export interface ChainOutcome {
	tool: string;
	description?: string;
	arguments?: Record<string, unknown>;
	result?: string;
	ok?: boolean;
}

export interface Critique {
	verdict: 'approve' | 'revise';
	issues: string[];
}

export interface CorrectiveStep {
	tool: string;
	arguments: Record<string, unknown>;
	description: string;
	reason: string;
}

export interface CriticInput {
	command: string;
	outcomes: ChainOutcome[];
	tools: ToolDefinition[];
}

export interface OptimizeInput extends CriticInput {
	issues: string[];
}

const PLANNER_SYSTEM = `You are the planner in a multi-model agent chain. Turn the user's command into
the best single action carried out with one tool call. Reply with exactly ONE
JSON object, no prose, of shape:
{"tool":"<tool name>","arguments":{...},"description":"short summary"}
Rules:
- Use only tools from the schema. Never invent tool or argument names.
- Prefer concrete arguments: file paths, app names, URLs, exact commands.
- If the command needs no tool, use the "chat" tool.`;

const EXECUTOR_SYSTEM = `You are the executor in a multi-model agent chain. A step has been planned but
its arguments may be incomplete or ambiguous. Fill in / correct ONLY the
"arguments" for the given tool based on the user's command and the current
context. Reply with exactly ONE JSON object of shape {"arguments":{...}}.
Rules:
- Keep argument keys from the tool schema. Never invent keys.
- Do not change the tool name. If you cannot determine an argument, omit it.`;

const CRITIC_SYSTEM = `You are the critic in a multi-model agent chain. Review whether the executed
steps fully satisfied the user's command. Reply with exactly ONE JSON object,
no prose, of shape:
{"verdict":"approve"|"revise","issues":["<concrete issue>", ...]}
Rules:
- "approve" only when the command is fully satisfied by the results shown.
- Otherwise "revise" and list concrete, actionable issues (missing step,
  wrong target, error to fix, follow-up worth doing).
- Never invent issues; do not say more than a short list.`;

const OPTIMIZER_SYSTEM = `You are the optimizer in a multi-model agent chain. Given the original command,
the steps already executed, and the critic's issues, correct the residue of the
task by proposing NEW tool calls. Reply with exactly ONE JSON object, no
prose, of shape:
{"steps":[{"tool":"<tool>","arguments":{...},"description":"...","reason":"..."}]}
Rules:
- Propose only steps that are NOT yet done and that fix the critic's issues.
- Use only tools from the schema. Never invent tool or argument names.
- When no further step can help, reply {"steps":[]}.`;

export function buildOutcomeText(outcomes: ChainOutcome[]): string {
	if (outcomes.length === 0) return '(no steps executed yet)';
	return outcomes
		.map(
			(o, i) =>
				`${i + 1}. ${o.tool}${o.description ? ` — ${o.description}` : ''}${
					o.ok === false ? ' : FAILED' : o.ok === true ? ' : ok' : ''
				}${
					o.arguments && Object.keys(o.arguments).length > 0
						? `\n   args: ${JSON.stringify(o.arguments).slice(0, 400)}`
						: ''
				}\n   result: ${(o.result ?? '(no result)').slice(0, 600)}`
		)
		.join('\n');
}

function makeStep(
	tool: string,
	arguments_: Record<string, unknown>,
	description: string,
	index: number
): PlanStep {
	return {
		id: randomUUID(),
		index,
		tool,
		description,
		args: arguments_,
		status: 'pending',
		pending: true,
		running: false
	};
}

/**
 * ModelChain drives the multi-model chain. Each method delegates to the router
 * role assigned in config/models.yaml (planner -> account 1, executor -> 2,
 * critic -> 3, optimizer -> 4) so four models from up to four OpenRouter
 * accounts collaborate on every task. All methods degrade to empty results on
 * any failure so the deterministic agent loop is never blocked by the chain.
 */
export class ModelChain {
	constructor(
		private readonly llm: Pick<Router, 'continueRole'>,
		private readonly emit?: (role: ChainRole, message: string) => void
	) {}

	private async runRole(role: ChainRole, messages: LLMChatMessage[]): Promise<string> {
		try {
			const res = await this.llm.continueRole(role, {
				messages,
				temperature: role === 'critic' ? 0 : 0.2
			});
			this.emit?.(role, res.content.slice(0, 400));
			return res.content;
		} catch (err) {
			this.emit?.(role, `chain unavailable: ${(err as Error).message}`);
			return '';
		}
	}

	/** planner: propose the full plan for a command (falls back to the agent's deterministic planner). */
	async plan(command: string, tools: ToolDefinition[]): Promise<PlanStep[]> {
		const content = await this.runRole('planner', [
			{ role: 'system', content: PLANNER_SYSTEM },
			{
				role: 'user',
				content: `Command: "${command}"\n\nAvailable tools:\n${JSON.stringify(tools, null, 2)}`
			}
		]);
		const call = extractJson<{
			tool?: string;
			name?: string;
			arguments?: Record<string, unknown>;
			description?: string;
		}>(content);
		const name = call?.tool ?? call?.name;
		if (!name || !call) return [];
		return [makeStep(name, call.arguments ?? {}, call.description ?? name, 0)];
	}

	/** executor: fill in or refine a step's arguments with a second model. */
	async completeArgs(
		command: string,
		step: { tool: string; arguments?: Record<string, unknown>; description?: string },
		tools: ToolDefinition[]
	): Promise<Record<string, unknown> | null> {
		const content = await this.runRole('executor', [
			{ role: 'system', content: EXECUTOR_SYSTEM },
			{
				role: 'user',
				content:
					`Command: "${command}"\n` +
					`Step: ${step.tool}${step.description ? ` (${step.description})` : ''}\n` +
					`Planned arguments: ${JSON.stringify(step.arguments ?? {})}\n\n` +
					`Tool schema (relevant): ${JSON.stringify(
						tools.find((t) => t.name === step.tool) ?? {},
						null,
						2
					)}`
			}
		]);
		const parsed = extractJson<{ arguments?: Record<string, unknown> }>(content);
		return parsed?.arguments ?? null;
	}

	/** critic: review executed outcomes against the command. */
	async critique(input: CriticInput): Promise<Critique | null> {
		const content = await this.runRole('critic', [
			{ role: 'system', content: CRITIC_SYSTEM },
			{
				role: 'user',
				content:
					`Command: "${input.command}"\n\nExecuted steps:\n${buildOutcomeText(input.outcomes)}\n\n` +
					`Available tools:\n${JSON.stringify(input.tools, null, 2)}`
			}
		]);
		const parsed = extractJson<{ verdict?: string; issues?: unknown }>(content);
		const verdict = parsed?.verdict === 'approve' ? 'approve' : 'revise';
		const issues = Array.isArray(parsed?.issues)
			? parsed.issues.filter((i): i is string => typeof i === 'string').slice(0, 8)
			: [];
		if (verdict === 'approve' || issues.length === 0) return { verdict, issues: [] };
		return { verdict, issues };
	}

	/** optimizer: convert critic feedback into corrective steps. */
	async optimize(input: OptimizeInput): Promise<CorrectiveStep[]> {
		const content = await this.runRole('optimizer', [
			{ role: 'system', content: OPTIMIZER_SYSTEM },
			{
				role: 'user',
				content:
					`Command: "${input.command}"\n\nExecuted steps:\n${buildOutcomeText(input.outcomes)}\n\n` +
					`Critic issues:\n${input.issues.map((i) => `- ${i}`).join('\n')}\n\n` +
					`Available tools:\n${JSON.stringify(input.tools, null, 2)}`
			}
		]);
		const parsed = extractJson<{ steps?: unknown }>(content);
		if (!Array.isArray(parsed?.steps)) return [];
		const hasTool = (name: string) => input.tools.some((t) => t.name === name);
		const steps: CorrectiveStep[] = [];
		for (const raw of parsed.steps) {
			if (!raw || typeof raw !== 'object') continue;
			const s = raw as Record<string, unknown>;
			if (typeof s.tool !== 'string' || !hasTool(s.tool)) continue;
			const args = s.arguments;
			if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)))
				continue;
			steps.push({
				tool: s.tool,
				arguments: (args as Record<string, unknown>) ?? {},
				description: String(s.description ?? s.tool),
				reason: String(s.reason ?? '')
			});
		}
		return steps.slice(0, 5);
	}
}
