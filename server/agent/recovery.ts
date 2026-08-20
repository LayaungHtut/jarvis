import type { Router } from '../llm/router';
import type { ToolDefinition } from '../llm/enhanced';
import type { LLMChatMessage } from '../llm/base';

export type RecoveryAction = 'retry' | 'workaround' | 'giveup';

export interface RecoveryInput {
	/** The user's original command (for intent context). */
	command: string;
	/** The failed step's tool name. */
	tool: string;
	/** The arguments that were passed to the failed tool. */
	arguments: Record<string, unknown>;
	/** Human-readable description of the failed step. */
	description: string;
	/** The failure message returned by the tool. */
	error: string;
	/** Prior successful tool calls in this task (tool + truncated result). */
	priorCalls: { tool: string; result?: string; data?: unknown }[];
	/** Schema of the tools the agent may use. */
	tools: ToolDefinition[];
}

export interface RecoverySuggestion {
	action: RecoveryAction;
	/** Tool to run when action is retry/workaround; empty for giveup. */
	tool: string;
	arguments: Record<string, unknown>;
	description: string;
	reason: string;
}

const RECOVERY_SYSTEM_PROMPT = `You are JARVIS's recovery planner. A tool call just failed while carrying out a user command.

Classify how to recover and reply with exactly ONE JSON object, no prose:
{
  "action": "retry" | "workaround" | "giveup",
  "tool": "<tool name>",
  "arguments": { ... },
  "description": "short human summary of the corrected call",
  "reason": "why this fixes the failure"
}

Rules:
- "retry": rerun the SAME tool, fixing the arguments (typos, wrong path, missing required field).
- "workaround": pick a DIFFERENT tool from the schema that still achieves the user's intent.
- "giveup": only when no tool in the schema can realistically succeed.
- Use only tools listed in the schema. Never invent tool names or argument keys.`;

export class RecoveryPlanner {
	constructor(private readonly llm: Pick<Router, 'continue'>) {}

	/** Ask the LLM how to recover. Returns null when the model is unusable or the answer is invalid. */
	async suggest(input: RecoveryInput): Promise<RecoverySuggestion | null> {
		const hasTool = (name: string) => input.tools.some((t) => t.name === name);
		try {
			const res = await this.llm.continue(
				{ messages: buildRecoveryPrompt(input), temperature: 0 },
				'reasoning'
			);
			return parseRecoverySuggestion(res.content, hasTool);
		} catch {
			return null;
		}
	}
}

function summarizePrior(call: { tool: string; result?: string; data?: unknown }): string {
	let line = `- ${call.tool}: ${call.result ?? '(no result)'}`;
	const data = call.data as { elements?: Array<Record<string, unknown>> } | undefined;
	if (data?.elements && Array.isArray(data.elements) && data.elements.length) {
		const items = data.elements
			.slice(0, 15)
			.map(
				(e) =>
					`${String(e.name ?? '')} (${String(e.type ?? '')}${Number.isFinite(Number(e.x)) ? ` @ ${e.x},${e.y}` : ''})`
			)
			.join(', ');
		line += ` | elements: ${items}${data.elements.length > 15 ? ', …' : ''}`;
	}
	return line;
}

export function buildRecoveryPrompt(input: RecoveryInput): LLMChatMessage[] {
	const prior = input.priorCalls.length
		? input.priorCalls.map(summarizePrior).join('\n')
		: '(none)';
	const user =
		`Command: "${input.command}"\n` +
		`Failed step: ${input.tool} (${input.description || 'no description'})\n` +
		`Arguments: ${JSON.stringify(input.arguments)}\n` +
		`Error: ${input.error.slice(0, 1000)}\n` +
		`Prior calls:\n${prior}\n\n` +
		`Available tools:\n${JSON.stringify(input.tools, null, 2)}`;
	return [
		{ role: 'system', content: RECOVERY_SYSTEM_PROMPT },
		{ role: 'user', content: user }
	];
}

export function parseRecoverySuggestion(
	content: string,
	hasTool: (name: string) => boolean
): RecoverySuggestion | null {
	const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	const candidate = match ? match[1] : content;
	let obj: unknown;
	try {
		obj = JSON.parse(candidate.trim());
	} catch {
		return null;
	}
	if (!obj || typeof obj !== 'object') return null;
	const { action, tool, arguments: args, description, reason } = obj as Record<string, unknown>;

	if (action === 'giveup') {
		return {
			action,
			tool: '',
			arguments: {},
			description: String(description ?? ''),
			reason: String(reason ?? '')
		};
	}
	if (action !== 'retry' && action !== 'workaround') return null;
	if (typeof tool !== 'string' || !hasTool(tool)) return null;
	if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
		return null;
	}
	return {
		action,
		tool,
		arguments: (args as Record<string, unknown>) ?? {},
		description: String(description ?? ''),
		reason: String(reason ?? '')
	};
}
