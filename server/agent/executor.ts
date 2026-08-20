import type { TaskState, ToolCallRecord } from '../../src/lib/shared/types';
import { ToolRegistry } from '../tools/registry';
import type { AgentContext } from './context';
import { updateStep, addToolCall } from './state';

export interface StepOutcome {
	success: boolean;
	message: string;
	data?: unknown;
	duration_ms: number;
}

/**
 * Executes the plan produced by the Planner (or the LLM). Each step is
 * dispatched through the ToolRegistry with the shared AgentContext so tools
 * can emit events, request permissions, and read memory. Records results back
 * into the TaskState.
 */
export class Executor {
	constructor(private readonly registry: ToolRegistry) {}

	async runStep(task: TaskState, index: number, context: AgentContext): Promise<StepOutcome> {
		const step = task.plan[index];
		if (!step) return { success: false, message: 'Step not found', duration_ms: 0 };

		updateStep(task, index, { status: 'running', running: true, pending: false });
		context.emit('TOOL_STARTED', {
			index: step.index,
			tool: step.tool,
			args: step.args,
			description: step.description
		});

		const call: ToolCallRecord = {
			id: crypto.randomUUID(),
			tool: step.tool,
			arguments: step.args,
			status: 'started'
		};
		addToolCall(task, call);

		const started = Date.now();
		try {
			const result = (await this.registry.execute(step.tool, step.args, context)) as {
				success?: boolean;
				message?: string;
				data?: unknown;
				error?: string;
			};
			const duration = Date.now() - started;
			const success = result?.success !== false;
			call.status = success ? 'completed' : 'failed';
			call.result = result?.message ?? '';
			call.data = result?.data;
			updateStep(task, index, {
				status: success ? 'completed' : 'failed',
				running: false,
				result: result?.message
			});
			context.emit(success ? 'TOOL_COMPLETED' : 'TOOL_FAILED', {
				index,
				tool: step.tool,
				message: result?.message,
				data: result?.data,
				duration_ms: duration
			});
			context.log(success ? 'info' : 'warn', `${step.tool}: ${result?.message ?? 'ok'}`, step.tool);
			return { success, message: result?.message ?? '', data: result?.data, duration_ms: duration };
		} catch (err) {
			const duration = Date.now() - started;
			call.status = 'failed';
			call.result = (err as Error).message;
			updateStep(task, index, { status: 'failed', running: false, result: (err as Error).message });
			context.emit('TOOL_FAILED', { index, tool: step.tool, error: (err as Error).message });
			context.log('error', `${step.tool}: ${(err as Error).message}`, step.tool);
			return { success: false, message: (err as Error).message, duration_ms: duration };
		} finally {
			call.arguments = step.args;
			context.emit('TASK_UPDATED', { task_id: task.task_id, task });
		}
	}
}
