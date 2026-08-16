import type { ClientMessage, ServerMessage } from '$lib/shared/protocol';
import { EVENT } from '$lib/shared/events';

export interface WsClientCallbacks {
	onSnapshot(message: Extract<ServerMessage, { type: 'snapshot' }>): void;
	onEvent(message: Extract<ServerMessage, { type: 'event' }>): void;
	onOpen?(): void;
	onClose?(): void;
	onError?(err: Event): void;
}

/**
 * Thin WebSocket wrapper for the JARVIS backend with automatic reconnection
 * and a JSON envelope matching server/protocol.ts. Lives on the browser side
 * only.
 */
export class JarvisClient {
	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private closing = false;
	private reconnectAttempt = 0;
	private keepalive: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly url: string,
		private readonly callbacks: WsClientCallbacks
	) {}

	get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	connect(): void {
		this.closing = false;
		if (
			this.ws &&
			(this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
		)
			return;
		try {
			this.ws = new WebSocket(this.url);
		} catch {
			this.scheduleReconnect();
			return;
		}
		this.ws.onopen = () => {
			this.reconnectAttempt = 0;
			this.callbacks.onOpen?.();
			this.startKeepalive();
		};
		this.ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(String(e.data)) as ServerMessage;
				if (msg.type === 'snapshot') this.callbacks.onSnapshot(msg);
				else this.callbacks.onEvent(msg);
			} catch {
				// ignore malformed frames
			}
		};
		this.ws.onerror = (e) => this.callbacks.onError?.(e);
		this.ws.onclose = () => {
			this.stopKeepalive();
			this.callbacks.onClose?.();
			if (!this.closing) this.scheduleReconnect();
		};
	}

	disconnect(): void {
		this.closing = true;
		this.stopKeepalive();
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.ws?.close();
		this.ws = null;
	}

	send(message: ClientMessage): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(message));
		}
	}

	command(text: string): void {
		this.send({ type: 'command', text });
	}

	stop(): void {
		this.send({ type: 'stop' });
	}

	cancelTask(taskId?: string): void {
		this.send({ type: 'cancel_task', task_id: taskId });
	}

	respondPermission(requestId: string, granted: boolean): void {
		this.send({ type: 'permission_response', request_id: requestId, granted });
	}

	setTrust(trusted: boolean): void {
		this.send({ type: 'set_trust', trusted });
	}

	requestSnapshot(): void {
		this.send({ type: 'request_snapshot' });
	}

	private scheduleReconnect(): void {
		if (this.closing) return;
		const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 15_000);
		this.reconnectAttempt++;
		this.reconnectTimer = setTimeout(() => this.connect(), delay);
	}

	private startKeepalive(): void {
		this.stopKeepalive();
		this.keepalive = setInterval(() => this.send({ type: 'ping' }), 20_000);
	}

	private stopKeepalive(): void {
		if (this.keepalive) clearInterval(this.keepalive);
		this.keepalive = null;
	}
}

/** Default backend URL: same origin via the Vite proxy, or a direct socket. */
export function resolveWsUrl(): string {
	const explicit = (import.meta.env?.PUBLIC_JARVIS_WS_URL as string | undefined)?.trim();
	if (explicit) return explicit;
	const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
	return `${proto}://${window.location.host}/ws`;
}

export function eventName(event: string): boolean {
	return EVENT[event as keyof typeof EVENT] !== undefined;
}
