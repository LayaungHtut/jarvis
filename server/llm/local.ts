import type { LLMRequest, LLMResult } from './base';
import { LLMError } from './base';
import type {
	EnhancedLLMProvider,
	EnhancedLLMRequest,
	EnhancedLLMResult,
	ToolCall
} from './enhanced';

interface LocalEndpoint {
	url: string;
	model: string;
}

function endpoint(): LocalEndpoint | null {
	const host = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:11434';
	return { url: host, model: process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b' };
}

interface Choice {
	message?: { content?: string; tool_calls?: unknown[] };
	finish_reason?: string;
}

/**
 * LocalProvider talks to any OpenAI-compatible local server (Ollama, LM Studio,
 * llama.cpp). Since exactly-once tool-call shapes vary between backends, tool
 * calls are parsed out of a JSON fenced block when the model encodes them
 * itself; otherwise the assistant text is returned as-is.
 */
export class LocalProvider implements EnhancedLLMProvider {
	readonly name = 'local';

	get available(): boolean {
		return Boolean(process.env.LOCAL_LLM_URL);
	}

	private async request(body: unknown): Promise<{ choices: Choice[] }> {
		const ep = endpoint();
		if (!ep) throw new LLMError('No local LLM endpoint configured.', this.name);
		try {
			const res = await fetch(`${ep.url}/v1/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...(body as object), model: ep.model }),
				signal: AbortSignal.timeout(120_000)
			});
			if (!res.ok) throw new LLMError(`Local LLM HTTP ${res.status}`, this.name);
			return (await res.json()) as { choices: Choice[] };
		} catch (err) {
			if (err instanceof LLMError) throw err;
			throw new LLMError(`Local LLM unreachable (${ep.url}). ${(err as Error).message}`, this.name);
		}
	}

	async generate(request: LLMRequest): Promise<LLMResult> {
		const data = await this.request({
			messages: request.messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: request.max_tokens ?? 1024,
			stream: false
		});
		const content = data.choices?.[0]?.message?.content ?? '';
		return { content, model: endpoint()?.model ?? 'local', provider: this.name };
	}

	async continue(request: EnhancedLLMRequest): Promise<EnhancedLLMResult> {
		let content: string;
		let finish = 'stop';
		const toolCalls: ToolCall[] = [];
		try {
			const data = await this.request({
				messages: request.messages,
				temperature: request.temperature ?? 0.2,
				stream: false
			});
			content = data.choices?.[0]?.message?.content ?? '';
			finish = data.choices?.[0]?.finish_reason ?? 'stop';
		} catch {
			// If the local backend is down we degrade to a deterministic planner.
			content = this.deterministicPlan(request.messages);
		}

		const extracted = extractJson<{ name?: string; arguments?: Record<string, unknown> }>(content);
		if (extracted && typeof extracted.name === 'string' && extracted.arguments) {
			toolCalls.push({
				id: crypto.randomUUID(),
				name: extracted.name,
				arguments: extracted.arguments
			});
			content = '';
		}
		return {
			content,
			tool_calls: toolCalls,
			finish_reason: finish,
			model: endpoint()?.model ?? 'local',
			provider: this.name
		};
	}

	/**
	 * Deterministic fallback used when the local model cannot be reached and
	 * local/OpenRouter providers are both unavailable. Maps simple intents to a
	 * tool call so the agent still functions without any network LLM.
	 */
	private deterministicPlan(messages: { role: string; content: string }[]): string {
		const text = (messages.at(-1)?.content ?? '').toLowerCase();
		const openPattern = /\b(?:open|launch|start)\s+(.+)/i;
		const openMatch = text.match(openPattern);
		const appNames = [
			['vscode', 'visual studio code', 'code'],
			['chrome', 'google chrome', 'browser'],
			['telegram'],
			['notepad', 'editor'],
			['terminal', 'cmd'],
			['explorer', 'file explorer'],
			['edge', 'microsoft edge'],
			['spotify'],
			['calculator']
		];
		if (openMatch) {
			const query = openMatch[1].toLowerCase();
			if (/\b(google|gmail)\s*(account|acc)|@/.test(query)) {
				const account = query
					.replace(/\b(google|gmail)\s*(account|acc)s?\b/g, '')
					.replace(/\b(the|my|named)\b/g, '')
					.trim();
				return JSON.stringify({
					name: 'open_google_account',
					arguments: { account: account || query }
				});
			}
			const found = appNames.find((names) => names.some((n) => query.includes(n)));
			if (found) {
				return JSON.stringify({ name: 'open_application', arguments: { application: found[0] } });
			}
			return JSON.stringify({
				name: 'open_application',
				arguments: { application: query.split(' ')[0] }
			});
		}
		if (
			/\b(list|what.{0,10}(open|running|now)|active windows)\b/.test(text) ||
			/\bwhat's? ?s? (open|running)\b/.test(text)
		) {
			return JSON.stringify({ name: 'list_windows', arguments: {} });
		}
		if (/\b(system|status|hardware|cpu|memory|ram|disk|info)\b/.test(text)) {
			return JSON.stringify({ name: 'system_info', arguments: {} });
		}
		if (/\b(stop|cancel|halt)\b/.test(text)) {
			return JSON.stringify({ name: 'stop_current', arguments: {} });
		}
		return JSON.stringify({ name: 'chat', arguments: { message: messages.at(-1)?.content ?? '' } });
	}
}

export function extractJson<T>(text: string): T | null {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	const candidate = fenced ? fenced[1] : text;
	try {
		return JSON.parse(candidate.trim()) as T;
	} catch {
		return null;
	}
}
