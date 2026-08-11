import type { EVENT } from '../../src/lib/shared/events';

export type EventType = (typeof EVENT)[keyof typeof EVENT];
export type EventHandler = (event: EventType, payload?: unknown) => void;

export interface JarvisEvent {
	event: EventType;
	payload?: unknown;
	timestamp: string;
	task_id?: string;
}

/**
 * A tiny asynchronous event bus. Publish/subscribe used by the agent core,
 * tools, and the WebSocket transport. Separated from the wire protocol so the
 * backend can be tested headlessly.
 */
export class EventBus {
	private readonly handlers: Set<EventHandler> = new Set();

	subscribe(handler: EventHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	emit(event: EventType, payload?: unknown): void {
		for (const handler of this.handlers) handler(event, payload);
	}

	emitJarvis(event: EventType, payload?: unknown, task_id?: string): JarvisEvent {
		const ev: JarvisEvent = { event, payload, timestamp: new Date().toISOString(), task_id };
		queueMicrotask(() => {
			for (const handler of this.handlers) {
				try {
					handler(event, payload);
				} catch (err) {
					console.error('[bus] handler error', err);
				}
			}
		});
		return ev;
	}

	clear(): void {
		this.handlers.clear();
	}
}
