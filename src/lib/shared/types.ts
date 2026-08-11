export type AgentStatus =
	| 'idle'
	| 'listening'
	| 'wake'
	| 'processing'
	| 'thinking'
	| 'executing'
	| 'observing'
	| 'speaking'
	| 'error';

export type TaskStatus =
	'pending' | 'planning' | 'executing' | 'observing' | 'completed' | 'failed' | 'cancelled';

export type PermissionLevel = 'low' | 'medium' | 'high' | 'critical';

export type ModelCategory =
	'conversation' | 'planning' | 'reasoning' | 'coding' | 'vision' | 'summarization' | 'extraction';

/**
 * Roles in the multi-model agent chain. Each role can be assigned a different
 * OpenRouter account + model, so a task is planned, executed, critiqued and
 * optimized by up to four different models.
 */
export type ChainRole = 'planner' | 'executor' | 'critic' | 'optimizer';

export const CHAIN_ROLES: ChainRole[] = ['planner', 'executor', 'critic', 'optimizer'];

export interface PlanStep {
	id: string;
	index: number;
	tool: string;
	description: string;
	args: Record<string, unknown>;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
	pending: boolean;
	result?: string;
	running: boolean;
}

export interface ToolCallRecord {
	id: string;
	tool: string;
	arguments: Record<string, unknown>;
	status: 'started' | 'completed' | 'failed';
	result?: string;
}

export interface TaskState {
	task_id: string;
	user_request: string;
	command: string;
	status: TaskStatus;
	plan: PlanStep[];
	current_step: number;
	tool_calls: ToolCallRecord[];
	observations: string[];
	errors: string[];
	result: string | null;
	started_at: string;
	finished_at: string | null;
	max_iterations: number;
}

export interface ConversationMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: string;
	task_id?: string;
}

export interface LogEntry {
	id: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
	tool?: string;
	task_id?: string;
	timestamp: string;
}

export interface ToolInfo {
	name: string;
	description: string;
	permission_level: PermissionLevel;
	parameters: ToolParameter[];
}

export interface ToolParameter {
	name: string;
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
}

export interface ModelInfo {
	category: ModelCategory;
	provider: string;
	model: string;
}

export interface PermissionRequest {
	request_id: string;
	tool: string;
	arguments: Record<string, unknown>;
	level: PermissionLevel;
}

export interface SystemInfo {
	platform: string;
	arch: string;
	hostname: string;
	release: string;
	uptime_seconds: number;
	cpu_model: string;
	cpu_cores: number;
	cpu_load: number[];
	memory_total: number;
	memory_free: number;
	memory_used: number;
	active_window: string | null;
	process_count: number;
	disk_total: number;
	disk_free: number;
}
