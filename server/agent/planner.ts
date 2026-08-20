import pl from 'tau-prolog';
import listsModule from 'tau-prolog/modules/lists.js';
import type { PlanStep } from '../../src/lib/shared/types';
import { randomUUID } from 'node:crypto';
import { INTENTS_PROGRAM } from './intents';

export interface PlannedAction {
	steps: PlanStep[];
}

interface RawIntent {
	priority: number;
	tool: string;
	args: Record<string, unknown>;
}

let listsRegistered = false;

/** Register Tau Prolog's lists library once (member/2, findall, maplist, ...). */
function ensureLists(): void {
	if (listsRegistered) return;
	listsModule(pl);
	listsRegistered = true;
}

function consult(session: pl.Session, text: string): Promise<void> {
	return new Promise((resolve, reject) =>
		session.consult(text, { success: () => resolve(), error: reject })
	);
}

function query(session: pl.Session, goal: string): Promise<void> {
	return new Promise((resolve, reject) =>
		session.query(goal, { success: () => resolve(), error: reject })
	);
}

type AnswerResult = { kind: 'success'; answer: pl.Answer } | { kind: 'fail' } | { kind: 'limit' };

function answer(session: pl.Session): Promise<AnswerResult> {
	return new Promise((resolve, reject) => {
		session.answer({
			success: (a: pl.Answer) => resolve({ kind: 'success', answer: a }),
			fail: () => resolve({ kind: 'fail' }),
			error: reject,
			limit: () => resolve({ kind: 'limit' })
		});
	});
}

/** Convert a Tau Prolog term tree into plain JS values. */
function termToJs(term: unknown): unknown {
	if (term == null) return null;
	const t = term as { id?: string; value?: number; args?: unknown[] };
	if (typeof t.value === 'number') return t.value;
	if (t.id === '[]') return [];
	if (t.id === '.' && Array.isArray(t.args) && t.args.length === 2) {
		const arr: unknown[] = [];
		let cur = term as { id?: string; args?: unknown[] };
		while (cur && cur.id === '.' && Array.isArray(cur.args) && cur.args.length === 2) {
			arr.push(termToJs(cur.args[0]));
			cur = cur.args[1] as { id?: string; args?: unknown[] };
		}
		if (cur && cur.id !== '[]') arr.push(termToJs(cur));
		return arr;
	}
	if (Array.isArray(t.args) && t.args.length > 0) {
		return { [t.id ?? '']: t.args.map(termToJs) };
	}
	return t.id;
}

/** Turn the `plan(Command, Steps)` answer into raw { priority, tool, args }. */
function parseIntents(answer: pl.Answer | null): RawIntent[] {
	const stepsTerm = answer?.links?.S;
	if (!stepsTerm) return [];
	const steps = (termToJs(stepsTerm) as unknown[]) ?? [];
	const out: RawIntent[] = [];
	for (const s of steps) {
		const step = (s as { step?: unknown })?.step as unknown[] | undefined;
		if (!Array.isArray(step) || step.length !== 2) continue;
		const priority = step[0] as number;
		const intentTerm = (step[1] as { intent?: unknown } | undefined)?.intent as
			unknown[] | undefined;
		if (!Array.isArray(intentTerm) || intentTerm.length !== 2) continue;
		const tool = intentTerm[0] as string;
		const argsList = (intentTerm[1] as unknown[]) ?? [];
		const args: Record<string, unknown> = {};
		for (const kv of argsList as { [k: string]: unknown[] }[]) {
			const key = Object.keys(kv)[0];
			const val = Array.isArray(kv[key]) ? kv[key][0] : undefined;
			if (key) args[key] = val;
		}
		out.push({ priority, tool, args });
	}
	return out;
}

function escapeAtom(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function describe(tool: string, args: Record<string, unknown>): string {
	const s = (v: unknown) => String(v ?? '');
	switch (tool) {
		case 'open_application':
			return `Open ${s(args.application)}`;
		case 'open_google_account':
			return `Open Google account: ${s(args.account)}`;
		case 'open_url':
			return `Open ${s(args.url)}`;
		case 'search_web':
			return `Search web for: ${s(args.query)}`;
		case 'system_info':
			return 'Collect system information';
		case 'list_windows':
			return 'List open windows';
		case 'take_screenshot':
			return 'Take a screenshot';
		case 'run_command':
			return s(args.command).includes('npm run check')
				? 'Run project checks and tests'
				: `Run command: ${s(args.command)}`;
		case 'read_file':
			return `Read file: ${s(args.path)}`;
		case 'write_file':
			return `Write file: ${s(args.path)}`;
		case 'close_window':
			return `Close ${s(args.target)}`;
		case 'kill_process':
			return `Kill process ${s(args.target)}`;
		case 'set_volume':
			return `Set volume to ${s(args.percent)}%`;
		case 'adjust_volume':
			return `Adjust volume by ${s(args.delta)}`;
		case 'media_control':
			return args.action === 'mute' ? 'Mute' : `${s(args.action)} media`;
		case 'media_play':
			return `Play: ${s(args.query)}`;
		case 'copy_file':
			return `Copy file ${s(args.source)} to ${s(args.destination)}`;
		case 'clipboard_write':
			return 'Copy text to clipboard';
		case 'clipboard_read':
			return 'Read clipboard';
		case 'focus_window':
			return `Focus ${s(args.target)}`;
		case 'lock_screen':
			return 'Lock the workstation';
		case 'observe_screen':
			return 'Observe the screen';
		case 'ui_list':
			return 'List UI elements on the focused window';
		case 'ui_click':
			return `Click "${s(args.name)}"`;
		case 'search_files':
			return `Search files for: ${s(args.pattern)}`;
		case 'system_power':
			return `Power action: ${s(args.action)}`;
		case 'list_apps':
			return 'List installed applications';
		case 'system_services':
			return args.action === 'list'
				? 'List Windows services'
				: `${s(args.action)} service ${s(args.name)}`;
		case 'set_env_var':
			return `Set env var ${s(args.name)}`;
		case 'get_env_var':
			return `Get env var ${s(args.name)}`;
		case 'mouse_move':
			return `Move mouse to ${s(args.x)},${s(args.y)}`;
		case 'mouse_click':
			return `Click at ${s(args.x)},${s(args.y)}`;
		case 'type_text':
			return `Type: ${s(args.text)}`;
		case 'chat':
			return 'Conversational reply';
		case 'get_volume':
			return 'Read current volume level';
		case 'get_active_window':
			return 'Get the active window';
		case 'list_processes':
			return s(args.filter)
				? `List processes matching ${s(args.filter)}`
				: 'List running processes';
		case 'list_dir':
			return `List files in ${s(args.path)}`;
		case 'delete_file':
			return `Delete file ${s(args.path)}`;
		case 'move_file':
			return `Move ${s(args.source)} to ${s(args.destination)}`;
		case 'zip_folder':
			return `Zip ${s(args.source)} into ${s(args.archive)}`;
		case 'open_path':
			return `Open folder ${s(args.path)}`;
		case 'remember':
			return `Remember: ${s(args.content)}`;
		case 'recall':
			return s(args.query) ? `Recall memories about ${s(args.query)}` : 'Recall stored memories';
		case 'press_key':
			return `Press ${s(args.combo)}`;
		case 'scroll_wheel':
			return `Scroll ${s(args.direction)}`;
		case 'ui_set_text':
			return `Fill "${s(args.name)}" with text`;
		case 'show_notification':
			return `Notify: ${s(args.message)}`;
		case 'minimize_window':
			return `Minimize ${s(args.target)}`;
		case 'read_page':
			return `Read page: ${s(args.url)}`;
		default:
			return tool;
	}
}

/**
 * Deterministic intent planner. Runs the Prolog rule set in {@link INTENTS_PROGRAM}
 * against the (lowercased) command and turns the winning intents into ordered
 * PlanSteps. Works without any LLM; the Router adds language understanding on top.
 */
export class Planner {
	private readonly session: pl.Session;
	private readonly ready: Promise<void>;
	private queue: Promise<unknown> = Promise.resolve();

	constructor() {
		ensureLists();
		this.session = pl.create(100000);
		this.ready = consult(this.session, INTENTS_PROGRAM);
	}

	async plan(command: string): Promise<PlannedAction> {
		const run = () =>
			this.ready.then(async () => {
				const text = command.toLowerCase().trim();
				const intents = await this.solve(text);
				intents.sort((a, b) => a.priority - b.priority);
				return intents.map((raw, i) => this.toStep(raw, i, command));
			});
		this.queue = this.queue.then(run, run);
		const steps = (await this.queue) as PlanStep[];
		return { steps };
	}

	/** All candidate intents, ordered by priority — shows rule priority ordering. */
	async planIntents(command: string): Promise<RawIntent[]> {
		const run = () =>
			this.ready.then(async () => {
				const text = command.toLowerCase().trim();
				const intents = await this.solve(text);
				intents.sort((a, b) => a.priority - b.priority);
				return intents;
			});
		this.queue = this.queue.then(run, run);
		return this.queue as Promise<RawIntent[]>;
	}

	private async solve(text: string): Promise<RawIntent[]> {
		const goal = `plan('${escapeAtom(text)}', S).`;
		try {
			await query(this.session, goal);
			const ans = await this.answerLoop();
			return parseIntents(ans);
		} catch {
			return [];
		}
	}

	private async answerLoop(): Promise<pl.Answer | null> {
		for (let i = 0; i < 100; i++) {
			const res = await answer(this.session);
			if (res.kind === 'success') return res.answer;
			if (res.kind === 'fail') return null;
		}
		return null;
	}

	/**
	 * Deterministic recovery alternatives: re-plan the command excluding tools
	 * that have already failed, so the executor can swap a failed step for a
	 * different tool without an LLM round trip.
	 */
	async planAlternatives(command: string, excluded: string[]): Promise<{ steps: PlanStep[] }> {
		const run = () =>
			this.ready.then(async () => {
				const text = command.toLowerCase().trim();
				const ex = excluded.map((e) => `'${escapeAtom(e)}'`).join(',');
				const goal = `plan_excluding('${escapeAtom(text)}', [${ex}], S).`;
				try {
					await query(this.session, goal);
					const ans = await this.answerLoop();
					const intents = parseIntents(ans);
					intents.sort((a, b) => a.priority - b.priority);
					return intents.map((raw, i) => this.toStep(raw, i, command));
				} catch {
					return [];
				}
			});
		this.queue = this.queue.then(run, run);
		const steps = (await this.queue) as PlanStep[];
		return { steps };
	}

	/** Classify a command's risk level via the Prolog risk/2 rules. */
	async risk(command: string): Promise<'low' | 'medium' | 'high' | 'critical'> {
		const run = () =>
			this.ready.then(async () => {
				const text = command.toLowerCase().trim();
				const goal = `risk('${escapeAtom(text)}', R).`;
				await query(this.session, goal);
				const ans = await this.answerLoop();
				const value = ans?.links?.R;
				if (value == null) return 'low';
				const id = (value as { id?: string }).id ?? String(value);
				return (['low', 'medium', 'high', 'critical'] as const).includes(
					id as 'low' | 'medium' | 'high' | 'critical'
				)
					? (id as 'low' | 'medium' | 'high' | 'critical')
					: 'low';
			});
		this.queue = this.queue.then(run, run);
		const result = (await this.queue) as 'low' | 'medium' | 'high' | 'critical';
		return result;
	}

	/** Assert a friendly-name → app alias into the session (runtime learning). */
	async learnAppAlias(alias: string, app: string): Promise<boolean> {
		const run = () =>
			this.ready.then(async () => {
				const a = alias.toLowerCase().trim();
				if (!a || !app) return false;
				const goal = `assert_app_alias('${escapeAtom(a)}', '${escapeAtom(app)}').`;
				try {
					await query(this.session, goal);
					await this.answerLoop();
					return true;
				} catch {
					return false;
				}
			});
		this.queue = this.queue.then(run, run);
		const learned = (await this.queue) as boolean;
		return learned;
	}

	private toStep(raw: RawIntent, index: number, command: string): PlanStep {
		const args: Record<string, unknown> = { ...raw.args };
		if (raw.tool === 'set_env_var' || raw.tool === 'get_env_var') {
			args.name = String(args.name ?? '').toUpperCase();
		}
		if (raw.tool === 'chat' && !args.message) args.message = command;
		return {
			id: randomUUID(),
			index,
			tool: raw.tool,
			description: describe(raw.tool, args),
			args,
			status: 'pending',
			pending: true,
			running: false
		};
	}
}
