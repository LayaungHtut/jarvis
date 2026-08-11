import type { LLMChatMessage, LLMRequest, LLMResult } from './base';
import { LLMError } from './base';
import type {
	EnhancedLLMProvider,
	EnhancedLLMRequest,
	EnhancedLLMResult,
	ToolDefinition,
	ToolCall
} from './enhanced';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function post(path: string, body: unknown, apiKey: string): Promise<Response> {
	return fetch(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			'HTTP-Referer': 'http://localhost:5173',
			'X-Title': 'JARVIS'
		},
		body: JSON.stringify(body)
	});
}

export class OpenRouterProvider implements EnhancedLLMProvider {
	readonly name = 'openrouter';
	readonly apiKey: string;
	readonly model: string;
	readonly account: number;

	constructor(model = 'openai/gpt-4o-mini', apiKey?: string, account = 1) {
		this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
		this.model = model;
		this.account = account;
	}

	get available(): boolean {
		return this.apiKey.length > 0;
	}

	private async request(
		messages: LLMChatMessage[],
		tools: ToolDefinition[] | undefined,
		temperature: number,
		maxTokens: number
	): Promise<unknown> {
		if (!this.available) throw new LLMError('OPENROUTER_API_KEY is not configured', this.name);
		const res = await post(
			'/chat/completions',
			{
				model: this.model,
				messages,
				temperature,
				max_tokens: maxTokens,
				tools:
					tools && tools.length > 0
						? tools.map((t) => ({
								type: 'function',
								function: {
									name: t.name,
									description: t.description,
									parameters: t.parameters
								}
							}))
						: undefined
			},
			this.apiKey
		);
		if (!res.ok) {
			let detail = await res.text();
			if (detail.length > 500) detail = detail.slice(0, 500);
			throw new LLMError(`OpenRouter HTTP ${res.status}: ${detail}`, this.name);
		}
		return res.json();
	}

	async generate(request: LLMRequest): Promise<LLMResult> {
		const data = (await this.request(
			request.messages,
			undefined,
			request.temperature ?? 0.7,
			request.max_tokens ?? 1024
		)) as {
			choices: { message: { content: string | null } }[];
		};
		const content = data.choices?.[0]?.message?.content ?? '';
		return { content, model: this.model, provider: this.name };
	}

	async continue(request: EnhancedLLMRequest): Promise<EnhancedLLMResult> {
		const data = (await this.request(
			request.messages,
			request.tools,
			request.temperature ?? 0.2,
			request.max_tokens ?? 2048
		)) as {
			choices: {
				message: {
					content: string | null;
					tool_calls?: {
						id: string;
						type: string;
						function: { name: string; arguments: string };
					}[];
				};
				finish_reason: string;
			}[];
		};
		const message = data.choices?.[0]?.message;
		const tool_calls: ToolCall[] = (message?.tool_calls ?? [])
			.filter((tc) => tc.type === 'function')
			.map((tc) => {
				let args: Record<string, unknown>;
				try {
					args = JSON.parse(tc.function.arguments);
				} catch {
					args = { raw: tc.function.arguments };
				}
				return { id: tc.id, name: tc.function.name, arguments: args };
			});
		return {
			content: message?.content ?? '',
			tool_calls,
			finish_reason: data.choices?.[0]?.finish_reason ?? 'stop',
			model: this.model,
			provider: this.name
		};
	}
}
