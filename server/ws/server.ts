import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { EventBus } from '../events/bus';
import { EVENT } from '../../src/lib/shared/events';
import { Agent } from '../agent/agent';
import type { AgentDeps } from '../agent/agent';
import { ToolRegistry } from '../tools/registry';
import { Memory } from '../memory/memory';
import { Router } from '../llm/router';
import { ModelChain } from '../llm/chain';
import { PermissionGate, parsePolicy } from '../security/permissions';
import { collectAdvanced } from '../tools/system';
import type { SystemInfo, ConversationMessage, LogEntry } from '../../src/lib/shared/types';

interface ClientConnection {
	socket: WebSocket;
	alive: boolean;
}

/** JarvisServer wires the EventBus, Agent, Memory, LLM Router and WebSocket. */
export class JarvisServer {
	private readonly wss: WebSocketServer;
	private readonly bus: EventBus;
	private readonly agent: Agent;
	private readonly memory: Memory;
	private readonly registry: ToolRegistry;
	private readonly llm: Router;
	private readonly chain: ModelChain | undefined;
	private readonly clients = new Set<ClientConnection>();
	private system: SystemInfo | null = null;
	private conversation: ConversationMessage[] = [];
	private readonly logs: LogEntry[] = [];

	constructor(server: Server) {
		this.bus = new EventBus();
		this.memory = new Memory();
		this.registry = new ToolRegistry();
		this.llm = new Router();

		this.chain = new ModelChain(this.llm, (role, message) =>
			this.emitChainActivity({ role, message })
		);

		const deps: AgentDeps = {
			bus: this.bus,
			registry: this.registry,
			memory: this.memory,
			llm: this.llm,
			chain: this.chain,
			permissions: new PermissionGate(parsePolicy(process.env.JARVIS_PERMISSIONS)),
			conversation: () => this.conversation,
			appendConversation: (role, content) => this.appendConversation(role, content),
			onPermissionRequest: (request) => this.broadcastEvent(EVENT.PERMISSION_REQUESTED, request)
		};

		this.agent = new Agent(deps);
		this.wss = new WebSocketServer({ server, path: '/ws' });

		setInterval(() => {
			for (const client of this.clients) {
				if (!client.alive) {
					client.socket.terminate();
					this.clients.delete(client);
					continue;
				}
				client.alive = false;
				client.socket.ping();
			}
		}, 30_000).unref();

		this.bus.subscribe((event, payload) => {
			this.broadcastEvent(event, payload);
		});

		this.refreshSystem();
		const timer = setInterval(() => this.refreshSystem(), 5000);
		timer.unref();

		this.wss.on('connection', (socket) => {
			const client: ClientConnection = { socket, alive: true };
			this.clients.add(client);
			socket.on('pong', () => (client.alive = true));
			socket.on('message', (data) => this.onMessage(client, data));
			socket.on('close', () => this.clients.delete(client));
			socket.on('error', () => this.clients.delete(client));
			this.send(client, { type: 'snapshot', payload: this.snapshot() });
		});
	}

	// ------------------------------------------------------------------
	// Public API (used by server/index.ts for REST endpoints)
	// ------------------------------------------------------------------

	info(): {
		tools: unknown[];
		models: unknown;
		llm: unknown;
		chain_enabled: boolean;
		status: string;
	} {
		return {
			tools: this.registry.list(),
			models: this.llm.models,
			llm: this.llm.status(),
			chain_enabled: this.chain !== undefined,
			status: this.agent.getStatus()
		};
	}

	async memorySnapshot() {
		return this.memory.recall();
	}

	// ------------------------------------------------------------------
	// Internal helpers
	// ------------------------------------------------------------------

	private appendConversation(role: ConversationMessage['role'], content: string): void {
		this.conversation.push({
			id: crypto.randomUUID(),
			role,
			content,
			timestamp: new Date().toISOString()
		});
		this.broadcastEvent(EVENT.CONVERSATION_UPDATED, {
			conversation: this.conversation.slice(-100)
		});
	}

	private log(level: LogEntry['level'], message: string, tool?: string): void {
		const entry: LogEntry = {
			id: crypto.randomUUID(),
			level,
			message,
			tool,
			timestamp: new Date().toISOString()
		};
		this.logs.push(entry);
		if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
		this.broadcastEvent(EVENT.LOGGED, entry);
	}

	private async refreshSystem(): Promise<void> {
		try {
			this.system = await collectAdvanced();
			this.broadcastEvent(EVENT.SYSTEM_INFO_UPDATED, this.system);
		} catch (err) {
			this.log('error', `system info: ${(err as Error).message}`);
		}
	}

	private snapshot() {
		const pending = this.agent.getPendingPermission();
		return {
			status: this.agent.getStatus(),
			task: this.agent.getTask(),
			conversation: this.conversation.slice(-100),
			logs: this.logs.slice(-200),
			system: this.system,
			permissions: parsePolicy(process.env.JARVIS_PERMISSIONS).autoApprove,
			pending_permission: pending,
			trusted: this.agent.isTrusted()
		};
	}

	private send(client: ClientConnection, message: unknown): void {
		if (client.socket.readyState === WebSocket.OPEN) {
			client.socket.send(JSON.stringify(message));
		}
	}

	private broadcastEvent(event: string, payload?: unknown): void {
		const message = { type: 'event', event, payload };
		for (const client of this.clients) this.send(client, message);
	}

	/** Surface raw planner/executor/critic/optimizer output as a chain activity event. */
	private emitChainActivity(payload: { role: string; message: string }): void {
		this.broadcastEvent(EVENT.CHAIN_ACTIVITY, payload);
	}

	private onMessage(client: ClientConnection, raw: import('ws').RawData): void {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			this.log('warn', 'Received non-JSON message');
			return;
		}

		// Handle permission responses and commands in-process.
		switch (msg.type) {
			case 'ping':
				this.send(client, { type: 'event', event: EVENT.CONNECTED, payload: { pong: true } });
				break;
			case 'command': {
				const text = String(msg.text ?? '').trim();
				if (!text) return;
				const trust = /trust(?:ed)?\s+(?:mode\s+)?(on|enable)\b/i.test(text);
				const untrust = /trust(?:ed)?\s+(?:mode\s+)?(off|disable|revoke)\b/i.test(text);
				if (trust || untrust) {
					this.agent.setTrusted(trust);
					this.log('info', `Trusted session ${trust ? 'enabled' : 'disabled'} via command`);
					this.appendConversation(
						'system',
						trust
							? 'Trusted session enabled: JARVIS will act without asking until you say "trusted mode off" or "stop".'
							: 'Trusted session disabled.'
					);
					return;
				}
				void this.agent.handleCommand(text);
				break;
			}
			case 'stop':
			case 'cancel_task':
				this.log('info', 'Stop requested');
				this.agent.cancel();
				break;
			case 'permission_response': {
				const requestId = String(msg.request_id ?? '');
				const granted = msg.granted === true;
				this.agent.resolvePermission(requestId, granted);
				break;
			}
			case 'set_trust': {
				const trusted = msg.trusted === true;
				this.agent.setTrusted(trusted);
				this.log('info', `Trusted session ${trusted ? 'enabled' : 'disabled'}`);
				break;
			}
			case 'request_snapshot':
				this.send(client, { type: 'snapshot', payload: this.snapshot() });
				break;
			default:
				this.log('warn', `Unknown client message: ${String(msg.type)}`);
		}
	}
}
