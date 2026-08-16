import type {
	AgentStatus,
	TaskState,
	PermissionLevel,
	ConversationMessage,
	PlanStep
} from '../../src/lib/shared/types';
import { EVENT } from '../../src/lib/shared/events';
import { EventBus } from '../events/bus';
import { ToolRegistry } from '../tools/registry';
import { Planner } from './planner';
import { Executor } from './executor';
import { RecoveryPlanner } from './recovery';
import { createTask, completeTask, failTask, cancelTask, updateStep } from './state';
import { PermissionGate } from '../security/permissions';
import type { Memory } from '../memory/memory';
import type { LLMChatMessage } from '../llm/base';
import { Router } from '../llm/router';
import type { AgentContext } from './context';
import type { ToolCall } from '../llm/enhanced';
import type { ModelChain } from '../llm/chain';
import type { ChainOutcome, CorrectiveStep } from '../llm/chain';

const SYSTEM_PROMPT = `You are JARVIS, a local-first desktop AI assistant on Windows.
You plan tasks as ordered tool calls. When no tool is needed, reply conversationally.
Be concise and practical. Never invent tool arguments; only use the tools provided.`;

export interface PermissionRequest {
	request_id: string;
	tool: string;
	arguments: Record<string, unknown>;
	level: PermissionLevel;
}

export interface AgentDeps {
	bus: EventBus;
	registry: ToolRegistry;
	planner?: Planner;
	memory: Memory;
	llm: Router;
	permissions: PermissionGate;
	conversation: () => ConversationMessage[];
	appendConversation: (role: 'user' | 'assistant' | 'system', content: string) => void;
	onPermissionRequest: (request: PermissionRequest) => void;
	/** Multi-model chain (planner → executor → critic → optimizer). Enables the post-execution critique/optimize loop. */
	chain?: ModelChain;
	/** Max critique/optimize rounds a task may go through. Defaults to 2. */
	chainMaxRounds?: number;
}

/**
 * Agent is the orchestrator of a single user command:
 *   understand → plan → execute tool(s) → observe → evaluate → complete
 * It handles cancellation, timeouts, iteration caps, and delegates to the LLM
 * router for plan generation when a model is available.
 */
export class Agent {
	private status: AgentStatus = 'idle';
	private task: TaskState | null = null;
	private cancelled = false;
	private trusted = false;
	private currentRequest: PermissionRequest | null = null;
	private pendingResolvers = new Map<string, (v: boolean) => void>();
	private retried = new Set<string>();
	private readonly executor: Executor;
	private readonly planner: Planner;
	private readonly recovery: RecoveryPlanner;
	private readonly chain: ModelChain | undefined;
	private readonly chainMaxRounds: number;

	constructor(private readonly deps: AgentDeps) {
		this.executor = new Executor(deps.registry);
		this.planner = deps.planner ?? new Planner();
		this.recovery = new RecoveryPlanner(deps.llm);
		this.chain = deps.chain;
		this.chainMaxRounds = deps.chainMaxRounds ?? 2;
	}

	getStatus(): AgentStatus {
		return this.status;
	}

	getTask(): TaskState | null {
		return this.task;
	}

	getPendingPermission(): PermissionRequest | null {
		return this.currentRequest;
	}

	/** Engage or revoke trusted session mode (bypasses the permission gate). */
	setTrusted(value: boolean): void {
		this.trusted = value;
		this.deps.bus.emitJarvis(
			value ? EVENT.TRUST_STARTED : EVENT.TRUST_ENDED,
			{ trusted: value },
			this.task?.task_id
		);
	}

	isTrusted(): boolean {
		return this.trusted;
	}

	isBusy(): boolean {
		return (
			this.task !== null &&
			['pending', 'planning', 'executing', 'observing'].includes(this.task.status)
		);
	}

	cancel(): void {
		this.cancelled = true;
		if (this.task && ['planning', 'executing', 'observing', 'pending'].includes(this.task.status)) {
			cancelTask(this.task);
			this.deps.bus.emitJarvis(
				EVENT.TASK_CANCELLED,
				{ task_id: this.task.task_id },
				this.task.task_id
			);
			this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task: this.task }, this.task.task_id);
			this.setStatus('idle');
		}
	}

	resolvePermission(requestId: string, granted: boolean): void {
		const resolve = this.pendingResolvers.get(requestId);
		if (resolve) {
			this.pendingResolvers.delete(requestId);
			this.currentRequest = null;
			resolve(granted);
			this.deps.bus.emitJarvis(EVENT.PERMISSION_RESOLVED, { granted }, this.task?.task_id);
		}
	}

	async handleCommand(text: string): Promise<void> {
		if (this.isBusy()) {
			this.deps.appendConversation(
				'assistant',
				'I am already working on a task. Let me finish that first, or say "stop".'
			);
			return;
		}

		const taskId = crypto.randomUUID();
		this.task = createTask(text, taskId);
		this.cancelled = false;
		this.currentRequest = null;

		const context = this.makeContext(taskId);
		this.deps.appendConversation('user', text);
		this.setStatus('thinking');
		this.deps.bus.emitJarvis(EVENT.AGENT_STARTED, { task_id: taskId, command: text }, taskId);

		try {
			await this.runLoop(context);
		} catch (err) {
			failTask(this.task, (err as Error).message);
			this.deps.bus.emitJarvis(
				EVENT.TASK_FAILED,
				{ task_id: taskId, error: (err as Error).message },
				taskId
			);
			this.setStatus('error');
		} finally {
			this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task: this.task }, taskId);
		}
	}

	private async runLoop(context: AgentContext): Promise<void> {
		if (!this.task) return;
		const taskId = this.task.task_id;

		// 1. UNDERSTAND + PLAN
		// Deterministic planner first; escalate to the LLM planner when it only
		// yields the generic chat fallback (i.e. no tool was recognized). The
		// chain's "planner" model is used when available.
		let plan = (await this.planner.plan(this.task.command)).steps;
		const isJustChat = plan.length === 1 && plan[0].tool === 'chat';
		if (isJustChat && this.llmReady()) {
			const llmPlan = this.chain
				? await this.chain.plan(this.task.command, this.deps.registry.schema())
				: await this.llmPlan(this.task.command);
			if (llmPlan.length) plan = llmPlan;
		}

		this.task.plan = plan;
		this.deps.bus.emitJarvis(EVENT.PLAN_CREATED, { task_id: taskId, plan }, taskId);
		this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task: this.task }, taskId);
		this.setStatus('executing');

		// 2. EXECUTE each step in order
		for (let i = 0; i < this.task.plan.length; i++) {
			if (this.cancelled) break;
			this.task.current_step = i;
			if (i >= this.task.max_iterations) break;

			const outcome = await this.executor.runStep(this.task, i, context);
			if (!outcome.success) {
				const recovered = await this.attemptRecovery(context, i, outcome.message);
				if (!recovered) {
					failTask(this.task, `Step ${i} failed: ${outcome.message}`);
					this.deps.bus.emitJarvis(
						EVENT.TASK_FAILED,
						{ task_id: taskId, error: outcome.message },
						taskId
					);
					this.setStatus('error');
					return;
				}
			}
		}

		if (this.cancelled) {
			cancelTask(this.task);
			this.deps.bus.emitJarvis(EVENT.TASK_CANCELLED, { task_id: taskId }, taskId);
			this.setStatus('idle');
			return;
		}

		// 2.5 OPTIMIZE: run the critic → optimizer chain to refine the result.
		if (this.chain && this.llmReady()) {
			await this.runChainLoop(context, taskId);
		}

		// 3. COMPLETE
		const summary = this.summarize();
		completeTask(this.task, summary);
		this.deps.bus.emitJarvis(EVENT.TASK_COMPLETED, { task_id: taskId, result: summary }, taskId);
		this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task: this.task }, taskId);
		this.deps.appendConversation('assistant', summary);
		this.setStatus('idle');
	}

	private async attemptRecovery(
		context: AgentContext,
		stepIndex: number,
		message: string
	): Promise<boolean> {
		if (this.cancelled) return false;
		const task = this.task;
		const step = task?.plan[stepIndex];
		if (!step || !this.retriedAdded(step)) return false;

		if (this.llmReady()) {
			const suggestion = await this.recovery.suggest({
				command: task!.command,
				tool: step.tool,
				arguments: step.args,
				description: step.description,
				error: message,
				priorCalls: this.priorCalls(task!),
				tools: this.deps.registry.schema()
			});

			if (suggestion?.action === 'giveup') {
				context.log(
					'warn',
					`Recovery: giving up on step ${stepIndex + 1}: ${suggestion.reason}`,
					step.tool
				);
				return false;
			}
			if (suggestion && this.deps.registry.has(suggestion.tool)) {
				const corrected = {
					...step,
					tool: suggestion.tool,
					args: suggestion.arguments,
					description: suggestion.description || suggestion.reason,
					status: 'pending' as const,
					pending: true,
					running: false,
					result: undefined
				};
				updateStep(task!, stepIndex, corrected);
				context.log(
					'info',
					`Recovery: ${suggestion.action} step ${stepIndex + 1} with ${suggestion.tool}. ${suggestion.reason}`,
					step.tool
				);
				this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task: task }, task!.task_id);
				const retry = await this.executor.runStep(task!, stepIndex, context);
				return retry.success;
			}
			context.log(
				'info',
				'Recovery: LLM yielded no usable plan; retrying the step as-is.',
				step.tool
			);
		}

		context.log('info', `Retrying step ${stepIndex + 1}.`, step.tool);
		const retry = await this.executor.runStep(task!, stepIndex, context);
		return retry.success;
	}

	private retriedAdded(step: PlanStep): boolean {
		if (this.retried.has(step.id)) return false;
		this.retried.add(step.id);
		return true;
	}

	private priorCalls(task: TaskState): { tool: string; result?: string }[] {
		return task.tool_calls
			.filter((c) => c.status === 'completed')
			.slice(-8)
			.map((c) => ({ tool: c.tool, result: c.result }));
	}

	/** Run the critic → optimizer loop up to {@link chainMaxRounds} times. */
	private async runChainLoop(context: AgentContext, taskId: string): Promise<void> {
		const task = this.task;
		if (!task || !this.chain) return;
		const tools = this.deps.registry.schema();

		for (let round = 0; round < this.chainMaxRounds; round++) {
			if (this.cancelled) break;
			const outcomes = this.chainOutcomes(task);
			const critique = await this.chain.critique({ command: task.command, outcomes, tools });
			if (!critique || critique.verdict === 'approve' || critique.issues.length === 0) break;

			this.deps.bus.emitJarvis(
				EVENT.CHAIN_ACTIVITY,
				{ role: 'critic', round: round + 1, issues: critique.issues },
				taskId
			);
			context.log(
				'info',
				`Chain critic (round ${round + 1}): ${critique.issues.join(' | ')}`,
				'chain'
			);

			const corrective = await this.chain.optimize({
				command: task.command,
				outcomes,
				issues: critique.issues,
				tools
			});
			if (corrective.length === 0) break;

			this.deps.bus.emitJarvis(
				EVENT.CHAIN_ACTIVITY,
				{ role: 'optimizer', round: round + 1, steps: corrective },
				taskId
			);
			context.log(
				'info',
				`Chain optimizer (round ${round + 1}): ${corrective
					.map((c) => `${c.tool} (${c.description})`)
					.join(' → ')}`,
				'chain'
			);

			const startIndex = task.plan.length;
			const added = corrective.map((c, i) => this.correctiveStep(c, startIndex + i));
			task.plan.push(...added);
			this.deps.bus.emitJarvis(EVENT.TASK_UPDATED, { task }, taskId);

			for (let i = 0; i < added.length; i++) {
				if (this.cancelled) break;
				const index = startIndex + i;
				if (index >= task.max_iterations) break;
				task.current_step = index;
				const outcome = await this.executor.runStep(task, index, context);
				if (!outcome.success) {
					const step = added[i];
					await this.attemptRecovery(context, index, outcome.message);
					if (!this.retried.has(step.id)) {
						context.log('error', `Chain step ${index + 1} failed: ${outcome.message}`, step.tool);
					}
				}
			}
		}
	}

	private chainOutcomes(task: TaskState): ChainOutcome[] {
		return task.tool_calls
			.filter((c) => c.status === 'completed' || c.status === 'failed')
			.slice(-12)
			.map((c) => ({
				tool: c.tool,
				arguments: c.arguments,
				result: c.result,
				ok: c.status === 'completed'
			}));
	}

	private correctiveStep(step: CorrectiveStep, index: number): PlanStep {
		return {
			id: crypto.randomUUID(),
			index,
			tool: step.tool,
			description: step.description || step.reason,
			args: step.arguments,
			status: 'pending',
			pending: true,
			running: false
		};
	}

	private llmReady(): boolean {
		try {
			return this.deps.llm.status().available;
		} catch {
			return false;
		}
	}

	private async llmPlan(command: string): Promise<PlanStep[]> {
		const tools = this.deps.registry.schema();
		const messages: LLMChatMessage[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{
				role: 'user',
				content:
					`Command: "${command}"\n\n` +
					'Choose the best action using only the tools below. Reply with exactly one JSON object ' +
					'of shape {"tool":"...","arguments":{...}}.\n\n' +
					`Available tools:\n${JSON.stringify(tools, null, 2)}`
			}
		];
		try {
			const res = await this.deps.llm.continue({ messages, tools }, 'planning');
			const call = res.tool_calls[0] ?? parseJsonCall(res.content);
			if (call && this.deps.registry.has(call.name)) {
				return [
					{
						id: crypto.randomUUID(),
						index: 0,
						tool: call.name,
						description: call.name,
						args: call.arguments ?? {},
						status: 'pending' as const,
						pending: true,
						running: false
					}
				];
			}
		} catch (err) {
			this.deps.appendConversation('system', `LLM planning unavailable: ${(err as Error).message}`);
		}
		return [];
	}

	private summarize(): string {
		if (!this.task) return '';
		const done = this.task.tool_calls.filter((c) => c.status === 'completed');
		const parts = done.map((c) => c.result ?? c.tool).filter(Boolean);
		return parts.length ? parts.join(' | ') : 'Task finished.';
	}

	private makeContext(taskId: string): AgentContext {
		return {
			taskId,
			emit: (event, payload) => this.deps.bus.emitJarvis(event, payload, taskId),
			setStatus: (s) => this.setStatus(s),
			memory: this.deps.memory,
			requestPermission: async (req) => {
				if (this.trusted) return true;
				if (this.deps.permissions.requiresConfirmation(req.permission_level)) {
					return this.askPermission(req, taskId);
				}
				return true;
			},
			isCancelled: () => this.cancelled,
			cancel: () => this.cancel(),
			appendConversation: (role, content) => this.deps.appendConversation(role, content),
			log: (level, message, tool) =>
				this.deps.bus.emitJarvis(EVENT.LOGGED, { level, message, tool }, taskId)
		};
	}

	private askPermission(
		req: {
			permission_level: PermissionLevel;
			tool: string;
			arguments: Record<string, unknown>;
		},
		taskId: string
	): Promise<boolean> {
		const request: PermissionRequest = {
			request_id: crypto.randomUUID(),
			tool: req.tool,
			arguments: req.arguments,
			level: req.permission_level
		};
		this.currentRequest = request;
		this.deps.onPermissionRequest(request);
		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.currentRequest = null;
				this.deps.bus.emitJarvis(
					EVENT.PERMISSION_RESOLVED,
					{ granted: false, timeout: true },
					taskId
				);
				resolve(false);
			}, 60_000);
			this.pendingResolvers.set(request.request_id, (granted) => {
				clearTimeout(timer);
				resolve(granted);
			});
		});
	}

	private setStatus(status: AgentStatus): void {
		this.status = status;
		this.deps.bus.emitJarvis(EVENT.STATUS_CHANGED, { status }, this.task?.task_id);
	}
}

function parseJsonCall(content: string): ToolCall | null {
	const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	const candidate = match ? match[1] : content;
	try {
		const obj = JSON.parse(candidate.trim()) as {
			tool?: string;
			name?: string;
			arguments?: Record<string, unknown>;
		};
		const name = obj.tool ?? obj.name;
		if (name) return { id: crypto.randomUUID(), name, arguments: obj.arguments ?? {} };
	} catch {
		// fall through
	}
	return null;
}
