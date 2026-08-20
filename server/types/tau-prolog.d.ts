declare module 'tau-prolog' {
	export interface Answer {
		links?: Record<string, unknown>;
		id?: string;
		[attr: string]: unknown;
	}

	export interface Session {
		consult(
			text: string,
			callbacks?: { success?: () => void; error?: (err: unknown) => void }
		): void;
		query(goal: string, callbacks?: { success?: () => void; error?: (err: unknown) => void }): void;
		answer(callbacks?: {
			success?: (answer: Answer) => void;
			fail?: () => void;
			limit?: () => void;
			error?: (err: unknown) => void;
		}): void;
	}

	export function create(limit?: number): Session;
	export function format_answer(session: Session, answer: Answer): string;
	export function fromJavaScript(value: unknown): unknown;
}

declare module 'tau-prolog/modules/lists.js' {
	export default function register(pl: typeof import('tau-prolog')): void;
}
