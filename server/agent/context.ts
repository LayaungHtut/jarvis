import type { EVENT } from '../../src/lib/shared/events';
import type { AgentStatus, PermissionLevel } from '../../src/lib/shared/types';
import type { Memory } from '../memory/memory';

export interface AgentContext {
	taskId: string;
	emit(event: (typeof EVENT)[keyof typeof EVENT], payload?: unknown): void;
	setStatus(status: AgentStatus): void;
	memory: Memory;
	/** Ask the user to permit a HIGH/CRITICAL action. Resolves with true/false. */
	requestPermission(args: {
		permission_level: PermissionLevel;
		tool: string;
		arguments: Record<string, unknown>;
	}): Promise<boolean>;
	isCancelled(): boolean;
	cancel(): void;
	appendConversation(role: 'user' | 'assistant' | 'system', content: string): void;
	log(level: 'debug' | 'info' | 'warn' | 'error', message: string, tool?: string): void;
}
