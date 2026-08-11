import type { TaskState, PlanStep, ToolCallRecord, TaskStatus } from '../../src/lib/shared/types';

export const MAX_ITERATIONS = 12;
export const TASK_TIMEOUT_MS = 10 * 60_000;

export interface TaskLocalContext {
	cancelled: boolean;
}

export function createTask(command: string, taskId: string): TaskState {
	const now = new Date().toISOString();
	return {
		task_id: taskId,
		user_request: command,
		command,
		status: 'planning',
		plan: [],
		current_step: 0,
		tool_calls: [],
		observations: [],
		errors: [],
		result: null,
		started_at: now,
		finished_at: null,
		max_iterations: MAX_ITERATIONS
	};
}

export function updateStep(task: TaskState, index: number, patch: Partial<PlanStep>): void {
	if (task.plan[index]) task.plan[index] = { ...task.plan[index], ...patch };
}

export function addToolCall(task: TaskState, call: ToolCallRecord): void {
	task.tool_calls.push(call);
}

export function completeTask(
	task: TaskState,
	result: string | null,
	status: TaskStatus = 'completed'
): void {
	task.status = status;
	task.result = result;
	task.finished_at = new Date().toISOString();
}

export function failTask(task: TaskState, error: string): void {
	task.status = 'failed';
	task.errors.push(error);
	task.finished_at = new Date().toISOString();
}

export function cancelTask(task: TaskState): void {
	task.status = 'cancelled';
	task.finished_at = new Date().toISOString();
}
