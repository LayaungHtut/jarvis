import { describe, it, expect } from 'vitest';
import { parsePolicy, PermissionGate, DEFAULT_POLICY } from '../security/permissions';

describe('parsePolicy', () => {
	it('returns defaults for empty input', () => {
		expect(parsePolicy(undefined).autoApprove.low).toBe(true);
		expect(parsePolicy('').autoApprove).toEqual(DEFAULT_POLICY.autoApprove);
	});

	it('overrides a single level', () => {
		const policy = parsePolicy('high:true');
		expect(policy.autoApprove.high).toBe(true);
		expect(policy.autoApprove.medium).toBe(true);
	});

	it('supports multiple comma-separated policies', () => {
		const policy = parsePolicy('low:true,medium:false,high:false,critical:false');
		expect(policy.autoApprove.low).toBe(true);
		expect(policy.autoApprove.medium).toBe(false);
		expect(policy.autoApprove.high).toBe(false);
		expect(policy.autoApprove.critical).toBe(false);
	});

	it('accepts numeric 1/0 flags and case-insensitive levels', () => {
		const policy = parsePolicy('HIGH:1,medium:0');
		expect(policy.autoApprove.high).toBe(true);
		expect(policy.autoApprove.medium).toBe(false);
	});

	it('ignores unknown keys', () => {
		const policy = parsePolicy('bogus:true,low:false');
		expect(policy.autoApprove.low).toBe(false);
		expect(policy.autoApprove.high).toBe(false);
	});
});

describe('PermissionGate', () => {
	it('requires confirmation for denied levels', () => {
		const gate = new PermissionGate(parsePolicy('low:true,medium:false,high:false,critical:false'));
		expect(gate.requiresConfirmation('low')).toBe(false);
		expect(gate.requiresConfirmation('medium')).toBe(true);
		expect(gate.requiresConfirmation('critical')).toBe(true);
	});

	it('describes the decision', () => {
		const gate = new PermissionGate(parsePolicy('medium:true'));
		expect(gate.describe('medium')).toBe('auto-approved');
		expect(gate.describe('critical')).toBe('requires confirmation');
	});
});
