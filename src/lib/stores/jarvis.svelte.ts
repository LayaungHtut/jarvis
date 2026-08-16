import type {
	AgentStatus,
	TaskState,
	ConversationMessage,
	LogEntry,
	SystemInfo,
	PermissionRequest,
	PermissionLevel
} from '$lib/shared/types';
import type { SnapshotPayload } from '$lib/shared/protocol';
import { EVENT } from '$lib/shared/events';
import { JarvisClient, resolveWsUrl } from '$lib/api/ws-client';

class JarvisStore {
	connection = $state<'connecting' | 'connected' | 'disconnected'>('connecting');
	status: AgentStatus = $state('idle');
	task: TaskState | null = $state(null);
	conversation: ConversationMessage[] = $state([]);
	logs: LogEntry[] = $state([]);
	system: SystemInfo | null = $state(null);
	pendingPermission: PermissionRequest | null = $state(null);
	permissions: Record<PermissionLevel, string> | null = $state(null);
	trusted = $state(false);
	busy = $derived(
		this.status === 'thinking' || this.status === 'executing' || this.status === 'processing'
	);
	private client: JarvisClient | null = null;
	private input = '';

	connect(): void {
		if (this.client) return;
		const url = resolveWsUrl();
		this.client = new JarvisClient(url, {
			onSnapshot: ({ payload }) => this.applySnapshot(payload),
			onEvent: ({ event, payload }) => this.applyEvent(event, payload),
			onOpen: () => {
				this.connection = 'connected';
				this.client?.requestSnapshot();
			},
			onClose: () => {
				this.connection = this.logs.length ? this.connection : 'disconnected';
				this.client = null;
			},
			onError: () => (this.connection = 'disconnected')
		});
		this.client.connect();
	}

	disconnect(): void {
		this.client?.disconnect();
		this.client = null;
		this.connection = 'disconnected';
	}

	send(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		this.client?.command(trimmed);
		this.input = '';
	}

	stop(): void {
		this.client?.stop();
	}

	respondPermission(requestId: string, granted: boolean): void {
		this.client?.respondPermission(requestId, granted);
		this.pendingPermission = null;
	}

	setTrusted(trusted: boolean): void {
		this.trusted = trusted;
		this.client?.setTrust(trusted);
	}

	private pushLocalLog(level: LogEntry['level'], message: string): void {
		this.pushLog({ id: crypto.randomUUID(), level, message, timestamp: new Date().toISOString() });
	}

	private applySnapshot(payload: SnapshotPayload): void {
		this.status = payload.status;
		this.task = payload.task;
		this.conversation = payload.conversation;
		this.logs = payload.logs;
		this.system = payload.system;
		this.permissions = payload.permissions;
		this.pendingPermission = payload.pending_permission;
		this.trusted = payload.trusted;
	}

	private applyEvent(event: string, payload: unknown): void {
		switch (event) {
			case EVENT.STATUS_CHANGED:
				this.status = (payload as { status: AgentStatus }).status;
				break;
			case EVENT.TASK_UPDATED:
				this.task = (payload as { task: TaskState }).task;
				break;
			case EVENT.CONVERSATION_UPDATED:
				this.conversation = (payload as { conversation: ConversationMessage[] }).conversation;
				break;
			case EVENT.LOGGED:
				this.pushLog(payload as LogEntry);
				break;
			case EVENT.SYSTEM_INFO_UPDATED:
				this.system = payload as SystemInfo;
				break;
			case EVENT.PERMISSION_REQUESTED:
				this.pendingPermission = payload as PermissionRequest;
				break;
			case EVENT.PERMISSION_RESOLVED:
				this.pendingPermission = null;
				break;
			case EVENT.TRUST_STARTED:
				this.trusted = true;
				break;
			case EVENT.TRUST_ENDED:
				this.trusted = false;
				break;
			case EVENT.TASK_COMPLETED:
			case EVENT.TASK_FAILED:
			case EVENT.TASK_CANCELLED:
				// Task snapshots arrive via TASK_UPDATED; keep status in sync.
				break;
			case EVENT.ERROR: {
				const message = typeof payload === 'string' ? payload : 'Unknown error';
				this.pushLocalLog('error', message);
				break;
			}
			default:
				break;
		}
	}

	private pushLog(entry: LogEntry): void {
		this.logs = [...this.logs, entry].slice(-300);
	}
}

export const jarvis = new JarvisStore();
