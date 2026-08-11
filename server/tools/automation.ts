import { Tool, ok, fail } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';

const USER32 = `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class UiX {\n[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);\n[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);\n[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);\n[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);\n[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }\n}\n"@;`;

const KEY_VK: Record<string, number> = {
	enter: 0x0d,
	tab: 0x09,
	esc: 0x1b,
	escape: 0x1b,
	backspace: 0x08,
	delete: 0x2e,
	del: 0x2e,
	home: 0x24,
	end: 0x23,
	pageup: 0x21,
	pagedown: 0x22,
	up: 0x26,
	down: 0x28,
	left: 0x25,
	right: 0x27,
	insert: 0x2d,
	space: 0x20
};

const SENDKEYS_NAMED: Record<string, string> = {
	enter: '{ENTER}',
	tab: '{TAB}',
	esc: '{ESC}',
	escape: '{ESC}',
	backspace: '{BACKSPACE}',
	delete: '{DELETE}',
	del: '{DELETE}',
	home: '{HOME}',
	end: '{END}',
	pageup: '{PGUP}',
	pagedown: '{PGDN}',
	up: '{UP}',
	down: '{DOWN}',
	left: '{LEFT}',
	right: '{RIGHT}',
	insert: '{INSERT}',
	space: ' '
};

const MOD_VK: Record<string, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, win: 0x5b };
const SENDKEYS_MOD: Record<string, string> = { ctrl: '^', alt: '%', shift: '+' };

/** Escape a literal character for the SendKeys parser. */
export function sendKeysEscape(text: string): string {
	return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`);
}

/** Normalize a friendly modifier+key combo into a VK sequence. */
export function parseKeyCombo(combo: string): { mods: string[]; key: string } {
	const parts = combo
		.toLowerCase()
		.trim()
		.split(/[\s+]+/)
		.filter(Boolean);
	const mods = parts.filter((p) => p in MOD_VK);
	const key = parts.find((p) => !(p in MOD_VK)) ?? parts[0] ?? '';
	return { mods, key };
}

export function vkFor(key: string): number | null {
	if (key.length === 1) {
		const code = key.toUpperCase().charCodeAt(0);
		return code >= 0x41 && code <= 0x5a ? code : null;
	}
	if (key in KEY_VK) return KEY_VK[key];
	const f = /^f(\d{1,2})$/.exec(key);
	if (f) {
		const n = Number(f[1]);
		if (n >= 1 && n <= 24) return 0x70 + n - 1;
	}
	if (/^[0-9]$/.test(key)) return 0x30 + Number(key);
	return null;
}

export function sendKeysForKey(key: string): string | null {
	if (key.length === 1 && /^[a-zA-Z0-9]$/.test(key)) return key;
	if (key in SENDKEYS_NAMED) return SENDKEYS_NAMED[key];
	if (/^f(\d{1,2})$/.test(key)) return `{${key.toUpperCase()}}`;
	if (key.length === 1) return `{${key.toUpperCase()}}`;
	return null;
}

function intParam(args: Record<string, unknown>, key: string, fallback: number): number {
	const n = Number(args[key]);
	return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** Move the mouse cursor to absolute screen coordinates. */
export class MouseMoveTool extends Tool {
	name = 'mouse_move';
	description = 'Move the mouse cursor to absolute screen coordinates (x, y).';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'x', type: 'number', description: 'Horizontal screen coordinate.' },
		{ name: 'y', type: 'number', description: 'Vertical screen coordinate.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('mouse_move requires Windows.');
		const x = intParam(args, 'x', 0);
		const y = intParam(args, 'y', 0);
		try {
			const out = await runPs(
				`${USER32}\n[UiX]::SetCursorPos(${x}, ${y}); $p = New-Object -TypeName 'UiX+POINT'; [void][UiX]::GetCursorPos([ref]$p); "Moved to $($p.X),$($p.Y)"`
			);
			return ok(out || `Cursor moved to (${x}, ${y}).`);
		} catch (err) {
			return fail('Failed to move the cursor.', (err as Error).message);
		}
	}
}

/** Simulate a mouse click (optionally moving first). */
export class MouseClickTool extends Tool {
	name = 'mouse_click';
	description = 'Click a mouse button, optionally at screen coordinates first.';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'button', type: 'string', description: 'left | right | middle' },
		{ name: 'x', type: 'number', description: 'Optional x coordinate to click at.' },
		{ name: 'y', type: 'number', description: 'Optional y coordinate to click at.' },
		{ name: 'clicks', type: 'number', description: '1 or 2 for a double click.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('mouse_click requires Windows.');
		const button = String(args.button ?? 'left').toLowerCase();
		const flags: Record<string, [number, number]> = {
			left: [0x0002, 0x0004],
			right: [0x0008, 0x0010],
			middle: [0x0020, 0x0040]
		};
		const click = flags[button];
		if (!click) return fail(`Unsupported button "${button}".`, 'use left | right | middle');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { button, x: args.x, y: args.y }
		});
		if (!granted) return fail('Click was denied by the user.');
		const clicks = Math.min(2, Math.max(1, intParam(args, 'clicks', 1)));
		const x = Number(args.x);
		const y = Number(args.y);
		const move =
			Number.isFinite(x) && Number.isFinite(y)
				? `[UiX]::SetCursorPos(${Math.round(x)}, ${Math.round(y)});`
				: '';
		const script = `${USER32}\n${move}\n1..${clicks} | ForEach-Object { [UiX]::mouse_event(${click[0]}, 0, 0, 0, [UIntPtr]::Zero); [UiX]::mouse_event(${click[1]}, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 50 }; "Clicked ${button}"`;
		try {
			const out = await runPs(script);
			return ok(out || `Clicked ${button}.`);
		} catch (err) {
			return fail('Failed to click.', (err as Error).message);
		}
	}
}

/** Type literal text into the focused window via SendKeys. */
export class TypeTextTool extends Tool {
	name = 'type_text';
	description = 'Type literal text into the currently focused window (fast; no combos).';
	permissionLevel = 'high' as const;
	parameters = [{ name: 'text', type: 'string', description: 'Literal text to type.' }] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('type_text requires Windows.');
		const text = String(args.text ?? '');
		if (!text) return fail('Nothing to type.', 'empty text');
		if (text.length > 4000) return fail('Text is too long (max 4000 chars).');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { length: text.length }
		});
		if (!granted) return fail('Typing was denied by the user.');
		const escaped = sendKeysEscape(text);
		try {
			const out = await runPs(
				`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}'); "Typed ${text.length} characters."`,
				30_000
			);
			return ok(out || `Typed ${text.length} characters.`);
		} catch (err) {
			return fail('Failed to type.', (err as Error).message);
		}
	}
}

/** Press a key or shortcut combo like "ctrl+c", "alt+tab" or "win+r". */
export class PressKeyTool extends Tool {
	name = 'press_key';
	description =
		'Press a key or shortcut combo such as "ctrl+c", "alt+tab", "win+r", "enter", "f5".';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'combo', type: 'string', description: 'Modifiers and key, e.g. "ctrl+shift+esc".' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('press_key requires Windows.');
		const combo = String(args.combo ?? '')
			.toLowerCase()
			.trim();
		if (!combo) return fail('Missing combo.');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { combo }
		});
		if (!granted) return fail('Key press was denied by the user.');
		const { mods, key } = parseKeyCombo(combo);
		if (!key) return fail(`Invalid combo "${combo}".`);

		if (mods.includes('win')) {
			const vk = vkFor(key);
			if (vk === null) return fail(`Unsupported key "${key}".`);
			const lines = ['down', 'up'].map((phase) =>
				[0x5b, ...mods.filter((m) => m !== 'win').map((m) => MOD_VK[m]), vk]
					.map(
						(code) => `[UiX]::keybd_event(${code}, 0, ${phase === 'down' ? 0 : 2}, [UIntPtr]::Zero)`
					)
					.join('\n')
			);
			try {
				await runPs(`${USER32}\n${lines[0]}\n${lines[1]}`);
				return ok(`Pressed ${combo}.`);
			} catch (err) {
				return fail('Failed to press keys.', (err as Error).message);
			}
		}

		const skKey = sendKeysForKey(key);
		if (skKey === null) return fail(`Unsupported key "${key}".`);
		const sk = mods.map((m) => SENDKEYS_MOD[m]).join('') + skKey;
		try {
			await runPs(
				`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sk}')`
			);
			return ok(`Pressed ${combo}.`);
		} catch (err) {
			return fail('Failed to press keys.', (err as Error).message);
		}
	}
}

/** Scroll the mouse wheel up or down. */
export class ScrollTool extends Tool {
	name = 'scroll_wheel';
	description = 'Scroll the mouse wheel. direction is "up" or "down".';
	permissionLevel = 'high' as const;
	parameters = [
		{ name: 'direction', type: 'string', description: 'up | down' },
		{ name: 'clicks', type: 'number', description: 'Number of wheel notches (default 1).' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('scroll_wheel requires Windows.');
		const direction = String(args.direction ?? 'down').toLowerCase();
		const sign = direction === 'up' ? 1 : direction === 'down' ? -1 : NaN;
		if (!Number.isFinite(sign)) return fail(`Invalid direction "${direction}".`, 'use up | down');
		const clicks = Math.max(1, intParam(args, 'clicks', 1));
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { direction, clicks }
		});
		if (!granted) return fail('Scroll was denied by the user.');
		const delta = sign * 120 * Math.min(20, clicks);
		try {
			await runPs(`${USER32}\n[UiX]::mouse_event(0x0800, 0, 0, ${delta}, [UIntPtr]::Zero)`);
			return ok(`Scrolled ${direction} ${clicks} notch(es).`);
		} catch (err) {
			return fail('Failed to scroll.', (err as Error).message);
		}
	}
}
