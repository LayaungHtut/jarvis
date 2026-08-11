import { Tool, ok, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';

/**
 * Pure conversational reply — routes to the LLM router. Used when no tool
 * actions are needed; also serves as a terminal refresh of the task.
 */
export class ChatTool extends Tool {
	name = 'chat';
	description = 'Respond conversationally to the user.';
	permissionLevel = 'low' as const;
	parameters = [{ name: 'message', type: 'string', description: 'The reply to deliver.' }] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const message = requireString(args, 'message');
		context.setStatus('speaking');
		context.emit('SPEECH_STARTED', { message });
		context.appendConversation('assistant', message);
		return ok(message, { message });
	}
}
