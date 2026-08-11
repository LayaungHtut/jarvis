import type { LLMChatMessage } from './base';

export interface EnhancedLLMRequest {
	messages: LLMChatMessage[];
	temperature?: number;
	max_tokens?: number;
	tools?: ToolDefinition[];
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface EnhancedLLMResult {
	content: string;
	tool_calls: ToolCall[];
	finish_reason: string;
	model: string;
	provider: string;
}

export interface EnhancedLLMProvider {
	readonly name: string;
	continue(request: EnhancedLLMRequest): Promise<EnhancedLLMResult>;
}
