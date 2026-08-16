import type { EVENT } from './events';
import type {
	AgentStatus,
	ConversationMessage,
	LogEntry,
	PermissionRequest,
	PermissionLevel,
	SystemInfo,
	TaskState
} from './types';

/** Messages sent from the SvelteKit frontend to the JARVIS backend. */
export type ClientMessage =
	| { type: 'ping' }
	| { type: 'command'; text: string }
	| { type: 'stop' }
	| { type: 'cancel_task'; task_id?: string }
	| { type: 'permission_response'; request_id: string; granted: boolean }
	| { type: 'set_trust'; trusted: boolean }
	| { type: 'request_snapshot' };

/** Messages sent from the JARVIS backend to the SvelteKit frontend. */
export type ServerMessage =
	| { type: 'snapshot'; payload: SnapshotPayload }
	| { type: 'event'; event: (typeof EVENT)[keyof typeof EVENT]; payload?: unknown };

export interface SnapshotPayload {
	status: AgentStatus;
	task: TaskState | null;
	conversation: ConversationMessage[];
	logs: LogEntry[];
	system: SystemInfo | null;
	permissions: Record<PermissionLevel, string>;
	pending_permission: PermissionRequest | null;
	trusted: boolean;
}
