import type { PermissionLevel } from '../../src/lib/shared/types';

export interface PermissionPolicy {
	/** True when the level runs without asking the user. */
	autoApprove: Record<PermissionLevel, boolean>;
}

export const DEFAULT_POLICY: PermissionPolicy = {
	autoApprove: {
		low: true,
		medium: true,
		high: false,
		critical: false
	}
};

/** Parse a dotted permission config string like "low,middle-medium,high:true". */
export function parsePolicy(raw: string | undefined): PermissionPolicy {
	if (!raw) return DEFAULT_POLICY;
	const policy: PermissionPolicy = {
		autoApprove: { ...DEFAULT_POLICY.autoApprove }
	};
	for (const part of raw.split(/[,;]/)) {
		const [level, flag] = part.trim().split(':');
		if (level && flag !== undefined) {
			const key = level.toLowerCase() as PermissionLevel;
			if (key in policy.autoApprove) {
				policy.autoApprove[key] = flag.toLowerCase() === 'true' || flag === '1';
			}
		}
	}
	return policy;
}

export class PermissionGate {
	constructor(private readonly policy: PermissionPolicy) {}

	requiresConfirmation(level: PermissionLevel): boolean {
		return !this.policy.autoApprove[level];
	}

	describe(level: PermissionLevel): string {
		return this.requiresConfirmation(level) ? 'requires confirmation' : 'auto-approved';
	}
}
