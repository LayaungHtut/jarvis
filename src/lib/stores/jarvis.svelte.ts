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

const IDLE_LABELS: Record<Partial<(typeof EVENT)[keyof typeof EVENT]> | string, string> = {};

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
	listening = $state(false);
	transcript = $state('');
	transcribing = $state(false);
	micSupported = $state(false);
	voiceEnabled = $state(true);
	busy = $derived(
		this.status === 'thinking' || this.status === 'executing' || this.status === 'processing'
	);
	private client: JarvisClient | null = null;
	private input = '';
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];

	constructor() {
		void IDLE_LABELS;
		if (typeof window !== 'undefined') {
			this.micSupported =
				typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
		}
	}

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

	setVoice(enabled: boolean): void {
		this.voiceEnabled = enabled;
		this.client?.setVoice(enabled);
	}

	async toggleListening(): Promise<void> {
		if (this.listening) {
			this.stopListening();
			return;
		}
		if (!this.micSupported) {
			this.pushLocalLog('warn', 'Microphone capture is not supported in this browser.');
			return;
		}
		if (!this.client?.connected) {
			this.pushLocalLog('warn', 'Cannot listen: JARVIS core is offline.');
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.chunks = [];
			const recorder = new MediaRecorder(stream);
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) this.chunks.push(e.data);
			};
			recorder.onstop = () => this.finishRecording(recorder);
			recorder.start();
			this.recorder = recorder;
			this.transcript = '';
			this.listening = true;
			this.status = 'listening';
		} catch (err) {
			this.pushLocalLog('error', `Microphone access denied: ${(err as Error).message}`);
			this.listening = false;
		}
	}

	stopListening(): void {
		this.recorder?.stop();
		this.recorder = null;
		this.listening = false;
		this.status = this.busy ? 'processing' : 'idle';
	}

	/** Cancel an in-progress recording without sending it. */
	cancelListening(): void {
		this.chunks = [];
		this.stopListening();
		this.transcript = '';
	}

	private finishRecording(recorder: MediaRecorder): void {
		recorder.stream?.getTracks().forEach((t) => t.stop());
		const mime = recorder.mimeType || 'audio/webm';
		const blob = new Blob(this.chunks, { type: mime });
		this.chunks = [];
		this.listening = false;
		this.transcript = '';
		if (blob.size === 0) {
			this.pushLocalLog('warn', 'No audio captured.');
			this.status = 'idle';
			return;
		}
		this.transcribing = true;
		this.readAsB64(blob)
			.then((b64) => {
				this.client?.voiceAudio(b64, mime);
				this.transcribing = false;
				this.status = 'processing';
			})
			.catch((err) => {
				this.transcribing = false;
				this.pushLocalLog('error', `Could not read audio: ${(err as Error).message}`);
				this.status = 'idle';
			});
	}

	private readAsB64(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
			reader.onload = () => {
				const result = String(reader.result ?? '');
				const b64 = result.split(',')[1] ?? '';
				resolve(b64);
			};
			reader.readAsDataURL(blob);
		});
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
		this.voiceEnabled = payload.voice_enabled;
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
			case EVENT.WAKE_WORD_DETECTED:
				this.status = 'wake';
				break;
			case EVENT.LISTENING_STARTED:
				this.status = 'listening';
				break;
			case EVENT.TRANSCRIPTION_READY: {
				const text = (payload as { text?: string }).text ?? '';
				if (text.trim()) {
					this.transcript = text;
					this.pushLocalLog('info', `Heard: ${text}`);
				}
				break;
			}
			case EVENT.TASK_COMPLETED:
			case EVENT.TASK_FAILED:
			case EVENT.TASK_CANCELLED:
				// Task snapshots arrive via TASK_UPDATED; keep status in sync.
				break;
			case EVENT.SPEECH_STARTED:
				this.status = 'speaking';
				break;
			case EVENT.SPEECH_FINISHED:
				this.status = this.busy ? 'processing' : 'idle';
				break;
			case EVENT.VOICE_STATE_CHANGED:
				this.voiceEnabled = (payload as { enabled: boolean }).enabled;
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
