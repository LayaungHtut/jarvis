export interface LLMChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface LLMRequest {
	messages: LLMChatMessage[];
	temperature?: number;
	max_tokens?: number;
}

export interface LLMResult {
	content: string;
	model: string;
	provider: string;
}

export interface LLMProvider {
	readonly name: string;
	readonly supportsTools: boolean;
	generate(request: LLMRequest): Promise<LLMResult>;
}

export class LLMError extends Error {
	constructor(
		message: string,
		public readonly provider: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'LLMError';
	}
}
