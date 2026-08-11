import { describe, it, expect } from 'vitest';
import { Agent } from '../agent/agent';
import { EventBus } from '../events/bus';
import { EVENT } from '../../src/lib/shared/events';
import { ToolRegistry } from '../tools/registry';
import type { PermissionRequest } from '../agent/agent';

function mockRouter() {
	return {
		status: () => ({ provider: 'local', available: false, localUrl: null })
	} as unknown as import('../llm/router').Router;
}

function buildAgent(onPermissionRequest: (req: PermissionRequest) => void) {
	const bus = new EventBus();
	const events: string[] = [];
	bus.subscribe((e) => events.push(e));
	const agent = new Agent({
		bus,
		registry: new ToolRegistry(),
		memory: { recall: async () => [] } as unknown as import('../memory/memory').Memory,
		llm: mockRouter(),
		permissions: {
			requiresConfirmation: (level: string) => level === 'high' || level === 'critical'
		} as unknown as import('../security/permissions').PermissionGate,
		conversation: () => [],
		appendConversation: () => undefined,
		onPermissionRequest
	});
	return { agent, events };
}

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

describe('Agent trusted session', () => {
	it('starts untrusted', () => {
		const { agent } = buildAgent(() => undefined);
		expect(agent.isTrusted()).toBe(false);
	});

	it('enables and emits TRUST_STARTED', async () => {
		const { agent, events } = buildAgent(() => undefined);
		agent.setTrusted(true);
		await flush();
		expect(agent.isTrusted()).toBe(true);
		expect(events).toContain(EVENT.TRUST_STARTED);
	});

	it('disables and emits TRUST_ENDED', async () => {
		const { agent, events } = buildAgent(() => undefined);
		agent.setTrusted(true);
		await flush();
		agent.setTrusted(false);
		await flush();
		expect(agent.isTrusted()).toBe(false);
		expect(events).toContain(EVENT.TRUST_ENDED);
	});

	it('bypasses the permission gate for high-level tools when trusted', async () => {
		const permissionCalls: PermissionRequest[] = [];
		const { agent } = buildAgent((req) => permissionCalls.push(req));
		agent.setTrusted(true);
		// focus_window is 'high' → would normally require confirmation.
		await agent.handleCommand('focus z_nonexistent_window_xyz_999');
		expect(permissionCalls).toHaveLength(0);
	}, 30_000);

	it('requests permission for high-level tools when untrusted', async () => {
		const permissionCalls: PermissionRequest[] = [];
		let deny: (req: PermissionRequest) => void = () => undefined;
		const { agent } = buildAgent((req) => {
			permissionCalls.push(req);
			deny(req);
		});
		deny = (req) => setTimeout(() => agent.resolvePermission(req.request_id, false), 0);
		await agent.handleCommand('focus z_nonexistent_window_xyz_999');
		expect(permissionCalls.length).toBeGreaterThan(0);
		expect(permissionCalls[0].level).toBe('high');
	}, 30_000);
});
