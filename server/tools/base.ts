import type { PermissionLevel, ToolParameter } from '../../src/lib/shared/types';
import type { AgentContext } from '../agent/context';

export interface ToolResult {
	success: boolean;
	message: string;
	data?: unknown;
	error?: string;
	cancelled?: boolean;
}

export abstract class Tool {
	abstract readonly name: string;
	abstract readonly description: string;
	abstract readonly permissionLevel: PermissionLevel;
	abstract readonly parameters: readonly ToolParameter[];

	abstract execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult>;
}

export function ok(message: string, data?: unknown): ToolResult {
	return { success: true, message, data };
}

export function fail(message: string, error?: string): ToolResult {
	return { success: false, message, error };
}

export function requireString(args: Record<string, unknown>, key: string, maxLength = 500): string {
	const value = args[key];
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Missing required string parameter "${key}".`);
	}
	if (value.length > maxLength) {
		throw new Error(`Parameter "${key}" exceeds maximum length of ${maxLength}.`);
	}
	return value;
}

export function requireStrings(
	args: Record<string, unknown>,
	key: string,
	maxItems = 20
): string[] {
	const value = args[key];
	if (!Array.isArray(value)) {
		throw new Error(`Missing required array parameter "${key}".`);
	}
	if (value.length === 0 || value.length > maxItems) {
		throw new Error(`Parameter "${key}" must contain 1..${maxItems} items.`);
	}
	return value.map((v) => String(v));
}
