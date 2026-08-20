import type { Router } from '../llm/router';
import type { ToolDefinition } from '../llm/enhanced';
import type { LLMChatMessage } from '../llm/base';
import type { PlanStep } from '../../src/lib/shared/types';
import { randomUUID } from 'node:crypto';
import { extractJson } from '../llm/local';

export interface Interpretation {
	reasoning: string;
	steps: PlanStep[];
}

const INTERPRETER_SYSTEM = `You are JARVIS's command interpreter. Convert the user's free-form text or speech
transcript into an ordered list of concrete tool calls that best satisfy their
intent. Speech transcripts can be sloppy (dropped words, phonetic spelling).

Interpretation rules:
- "open <name> google account", "... gmail account" or "... google acc" means
  opening a signed-in Google/Gmail account named <name>: use open_google_account
  with account=<name>.
- "open <app>" maps to open_application when <app> is a real desktop application.
- A bare email address means a Google account: open_google_account.
- URLs map to open_url. A search phrase maps to search_web.
- Chain multiple steps only when they are genuinely sequential and necessary.

Reply with exactly ONE JSON object, no prose:
{"reasoning":"one sentence explaining the interpretation","steps":[{"tool":"<tool>","arguments":{...},"description":"short summary"}]}
Rules:
- Use only tools from the schema. Never invent tool or argument names.
- When the request is conversational or no tool applies, reply {"reasoning":"...","steps":[]}.`;

/**
 * CommandInterpreter is the AI reasoning layer that turns raw text or speech
 * into a structured, ordered plan of tool calls. It runs on the "reasoning"
 * model and always degrades to an empty result when the model is unavailable,
 * leaving the deterministic planner as the safety net.
 */
export class CommandInterpreter {
	constructor(private readonly llm: Pick<Router, 'continue'>) {}

	async interpret(command: string, tools: ToolDefinition[]): Promise<Interpretation> {
		const messages: LLMChatMessage[] = [
			{ role: 'system', content: INTERPRETER_SYSTEM },
			{
				role: 'user',
				content: `Command: "${command}"\n\nAvailable tools:\n${JSON.stringify(tools, null, 2)}`
			}
		];
		try {
			const res = await this.llm.continue({ messages, temperature: 0 }, 'reasoning');
			return parseInterpretation(res.content, tools);
		} catch {
			return { reasoning: '', steps: [] };
		}
	}
}

export function parseInterpretation(content: string, tools: ToolDefinition[]): Interpretation {
	const parsed = extractJson<{ reasoning?: string; steps?: unknown }>(content);
	if (!parsed || !Array.isArray(parsed.steps))
		return { reasoning: String(parsed?.reasoning ?? ''), steps: [] };
	const hasTool = new Set(tools.map((t) => t.name));
	const steps: PlanStep[] = [];
	let index = 0;
	for (const raw of parsed.steps) {
		if (!raw || typeof raw !== 'object') continue;
		const s = raw as Record<string, unknown>;
		if (typeof s.tool !== 'string' || !hasTool.has(s.tool)) continue;
		const args = s.arguments;
		if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
			continue;
		}
		steps.push({
			id: randomUUID(),
			index,
			tool: s.tool,
			description: String(s.description ?? s.tool),
			args: (args as Record<string, unknown>) ?? {},
			status: 'pending',
			pending: true,
			running: false
		});
		index++;
	}
	return { reasoning: String(parsed.reasoning ?? ''), steps };
}
