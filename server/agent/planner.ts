import type { PlanStep } from '../../src/lib/shared/types';
import { randomUUID } from 'node:crypto';

export interface PlannedAction {
	steps: PlanStep[];
}

const APP_KW = [
	'vscode',
	'code',
	'chrome',
	'telegram',
	'notepad',
	'terminal',
	'cmd',
	'explorer',
	'spotify',
	'calculator',
	'paint',
	'word',
	'excel'
];

/**
 * Lightweight intent parser that turns free-form commands into an ordered list
 * of tool calls. This is the deterministic layer that works even without an
 * LLM configured; the Router adds language understanding on top for complex
 * requests.
 */
export class Planner {
	plan(command: string): PlannedAction {
		const text = command.toLowerCase().trim();
		const steps: PlanStep[] = [];
		const push = (tool: string, description: string, args: Record<string, unknown>) => {
			steps.push({
				id: randomUUID(),
				index: steps.length,
				tool,
				description,
				args,
				status: 'pending',
				pending: true,
				running: false
			});
		};

		// Explicit "open X" where X is a known application.
		const openMatch = text.match(/\b(?:open|launch|start)\s+(.+)/);
		if (openMatch) {
			const target = openMatch[1].trim();
			if (target.startsWith('http')) {
				push('open_url', `Open ${target}`, { url: target });
			} else if (APP_KW.some((k) => target.includes(k))) {
				push('open_application', `Open ${target}`, { application: target });
			} else if (text.includes('search') || text.includes('youtube')) {
				push('search_web', `Search web for: ${target}`, { query: target });
			} else {
				push('open_application', `Open ${target}`, { application: target });
			}
		}

		// "search <query>"
		const searchMatch = !openMatch ? text.match(/\bsearch(?: for)?\s+(.+)/) : null;
		if (searchMatch)
			push('search_web', `Search web for: ${searchMatch[1].trim()}`, {
				query: searchMatch[1].trim()
			});

		// "system status / system info / how is my computer doing"
		if (
			!openMatch &&
			/(system|cpu|memory|ram|disk|hardware|battery|how.{0,10}(doing|runn))/.test(text)
		) {
			push('system_info', 'Collect system information', {});
		}

		// "what's open / list windows / what is on my screen"
		if (/(what.{0,10}(open|running|window)|list.{0,10}windows)/.test(text)) {
			push('list_windows', 'List open windows', {});
		}

		// "take a screenshot / capture the screen / what is wrong with this"
		if (/(screenshot|capture the screen|look at my screen)/.test(text)) {
			push('take_screenshot', 'Take a screenshot', {});
		}

		// "run the tests"
		if (/\b(run (the )?(unit )?tests|tests are failing|why is (my )?build failing)\b/.test(text)) {
			push('run_command', 'Run project checks and tests', {
				command: 'npm run check && npm test -- --run',
				timeout: 180_000
			});
		}

		// "read <file>"
		const readMatch = text.match(/\bread\s+(?:the\s+)?(file\s+)?(.+)/);
		if (readMatch && !text.includes('open'))
			push('read_file', `Read file: ${readMatch[2]}`, { path: readMatch[2] });

		// "create/write <file> with <content>"
		const writeMatch = text.match(
			/\b(?:create|write|make|save)\s+(?:a\s+)?(?:file\s+)?([\w.\-/\\]+)(?:\s+(?:with|containing|content)\s+(.+))?/i
		);
		if (writeMatch) {
			const path = writeMatch[1].trim();
			let content = (writeMatch[2] ?? '').trim().replace(/^(?:content|text|the\s+text)\s+/, '');
			if (!content) {
				const toMatch = text.match(/\bwith\s+(?:content|text|the\s+text)\s+(.+)/i);
				content = (toMatch ? toMatch[1] : `Created by JARVIS.`).trim();
			}
			push('write_file', `Write file: ${path}`, { path, content });
		}

		// "run <command> / execute <command>" — skip when it collided with tests
		const runMatch = text.match(/\b(?:run|execute)\s+(.+)/);
		if (runMatch && !/tests|check/.test(runMatch[1]) && !text.includes('test')) {
			push('run_command', `Run command: ${runMatch[1]}`, { command: runMatch[1] });
		}

		// "close X" / "kill X" → window / process control
		const closeMatch = text.match(/^(?:close|quit|kill)\s+(.+)/);
		if (closeMatch) {
			const verb = text.split(/\s+/)[0];
			const target = closeMatch[1].trim();
			if (verb === 'kill') {
				push('kill_process', `Kill process matching ${target}`, { target });
			} else if (/^\d+$/.test(target) || /\bprocess\b/.test(target)) {
				push('kill_process', `Kill process ${target}`, { target });
			} else {
				push('close_window', `Close ${target}`, { target });
			}
		}

		// "volume to 40" / "set volume 40%" / "volume up 10" / "mute"
		const volSet = text.match(/\b(?:set\s+)?volume(?:\s+to)?\s+(\d{1,3})(?:\s*%)?/);
		const volDelta = text.match(/\bvolume\s+(up|down)\s*(?:by\s+)?(\d{1,3})?/);
		if (volSet) {
			push('set_volume', `Set volume to ${volSet[1]}%`, { percent: Number(volSet[1]) });
		} else if (volDelta) {
			const delta = Number(volDelta[2] ?? 10) * (volDelta[1] === 'up' ? 1 : -1);
			push('adjust_volume', `Adjust volume by ${delta}`, { delta });
		} else if (/\bmute\b/.test(text)) {
			push('media_control', 'Mute', { action: 'mute' });
		}

		// media playback
		const mediaMatch = text.match(
			/\b(play|pause|resume|next|previous|prev|skip)\b.*(?:music|song|track|media|video|spotify)/
		);
		if (mediaMatch) {
			const word = mediaMatch[1];
			const action =
				word === 'next' || word === 'skip'
					? 'next'
					: word === 'previous' || word === 'prev'
						? 'previous'
						: 'play_pause';
			push('media_control', `${word} media`, { action });
		}

		// "copy <file> to <dest>" → copy_file; otherwise clipboard write
		const copyFile = text.match(/\bcopy\s+(?:file\s+)?([\w.\-/\\]+)\s+to\s+([\w.\-/\\]+)/);
		const copyMatch = text.match(/\b(?:copy|clipboard)\s+([\s\S]+)/);
		if (copyFile && !/\bclipboard\b/.test(text)) {
			push('copy_file', `Copy file ${copyFile[1]} to ${copyFile[2]}`, {
				source: copyFile[1],
				destination: copyFile[2]
			});
		} else if (copyMatch && !/\bclipboard\s+(?:read|show|what)/.test(text)) {
			push('clipboard_write', 'Copy text to clipboard', { text: copyMatch[1] });
		} else if (/\bclipboard\s+(?:read|show)|what.{0,10}clipboard/.test(text)) {
			push('clipboard_read', 'Read clipboard', {});
		}

		// "focus <app>" → focus its window
		const focusMatch = text.match(/\b(?:focus|bring up|switch to)\s+(.+)/);
		if (focusMatch && !text.includes('open')) {
			push('focus_window', `Focus ${focusMatch[1]}`, { target: focusMatch[1] });
		}

		// "move mouse to <x>,<y>" / "click at <x>,<y>"
		const moveMouse = text.match(/\b(?:move\s+)?mouse(?:\s+cursor)?\s+to\s+(\d+)\s*,\s*(\d+)/);
		if (moveMouse) {
			push('mouse_move', `Move mouse to ${moveMouse[1]},${moveMouse[2]}`, {
				x: Number(moveMouse[1]),
				y: Number(moveMouse[2])
			});
		}
		const clickAt = text.match(/\bclick\s+(?:at\s+)?(\d+)\s*,\s*(\d+)/);
		if (clickAt) {
			push('mouse_click', `Click at ${clickAt[1]},${clickAt[2]}`, {
				button: 'left',
				x: Number(clickAt[1]),
				y: Number(clickAt[2]),
				clicks: 1
			});
		}

		// "type <text>" → type into the focused window
		const typeMatch = text.match(/\btype(?:\s+out)?\s+([\s\S]+)/);
		if (typeMatch && !text.includes('file')) {
			push('type_text', `Type: ${typeMatch[1]}`, { text: typeMatch[1] });
		}

		// "lock" the screen
		if (/\block\s+(?:the\s+)?(screen|computer|pc|workstation)\b/.test(text)) {
			push('lock_screen', 'Lock the workstation', {});
		}

		// "look at my screen" / "see the screen" → observe_screen
		if (/(look at my screen|see the screen|observe|read the screen)/.test(text)) {
			push('observe_screen', 'Observe the screen', {});
		}

		// "what buttons / ui elements are on screen" → ui_list
		if (
			/(what (buttons|controls|ui)|show me the (buttons|controls|ui|menu)|list.*(buttons|controls))/i.test(
				text
			)
		) {
			push('ui_list', 'List UI elements on the focused window', {});
		}

		// "click the <label> button / click button <label> / click <label>"
		const uiClickQuote = text.match(/click\s+(?:on\s+)?["'](.+?)["']/);
		const uiClickLabel = text.match(
			/\bclick\s+(?:on\s+)?(?:the\s+)?(.+?)\s+(?:button|control|icon|menu\s+item|link)\b/
		);
		const uiClickControl = text.match(
			/\bclick\s+(?:on\s+)?(?:the\s+)?(?:button|control|icon|menu\s+item|link)\s+(?:named\s+|labeled\s+|called\s+)?(.+)/
		);
		if (uiClickQuote) {
			push('ui_click', `Click "${uiClickQuote[1]}"`, { name: uiClickQuote[1] });
		} else if (uiClickLabel) {
			push('ui_click', `Click "${uiClickLabel[1].trim()}"`, { name: uiClickLabel[1].trim() });
		} else if (uiClickControl) {
			push('ui_click', `Click "${uiClickControl[1].trim()}"`, {
				name: uiClickControl[1].trim()
			});
		}

		// "find/search for <file> on my computer" → search_files
		const fileSearch = text.match(
			/\b(?:find|search)(?:\s+for)?\s+(?:the\s+)?(?:file|folder|document)\s+(.+)/
		);
		if (fileSearch) {
			push('search_files', `Search files for: ${fileSearch[1].trim()}`, {
				pattern: fileSearch[1].trim()
			});
		}

		// "shut down / restart / sleep / hibernate the computer"
		const power = text.match(
			/\b(?:shut\s*down|shutdown|restart|reboot|hibernate|log\s*off|logoff)\b.{0,24}(?:computer|pc|system|machine|windows)\b/i
		);
		const sleepOnly = !power && /\bsleep\b/.test(text) && !/\bmode\b/.test(text);
		if (power || sleepOnly) {
			const word = power ? power[0].replace(/\s+/g, '') : 'sleep';
			const action = /restart|reboot/.test(word)
				? 'restart'
				: /hibernate/.test(word)
					? 'hibernate'
					: /logoff/.test(word)
						? 'logoff'
						: /shutdown|shut/.test(word)
							? 'shutdown'
							: 'sleep';
			push('system_power', `Power action: ${action}`, { action, delay_seconds: 5 });
		}

		// "list installed apps / what apps do I have" → list_apps
		if (/(list|show|what).{0,15}(installed|my)?\s*(apps|applications|programs)/.test(text)) {
			push('list_apps', 'List installed applications', {});
		}

		// services: "list services" / "restart the <x> service"
		const svcList = /(list|show).{0,10}services/.test(text);
		const svcAct = text.match(/\b(restart|stop|start)\s+(?:the\s+)?([\w\-. ]+?)\s+service\b/);
		if (svcList) {
			push('system_services', 'List Windows services', { action: 'list' });
		} else if (svcAct) {
			push('system_services', `${svcAct[1]} service ${svcAct[2].trim()}`, {
				action: svcAct[1].toLowerCase(),
				name: svcAct[2].trim()
			});
		}

		// env vars: "set <NAME> to <VALUE>" / "what is <NAME>"
		const envSet = text.match(
			/\b(?:set|create)\s+(?:the\s+)?(?:env(?:ironment)?\s+)?(?:var(?:iable)?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(?:to|as|equals|=)\s+(.+)/i
		);
		if (envSet) {
			push('set_env_var', `Set env var ${envSet[1].toUpperCase()}`, {
				name: envSet[1].toUpperCase(),
				value: envSet[2].trim()
			});
		} else {
			const envGet = text.match(
				/\b(?:what is|get|show|read)\s+(?:the\s+)?(?:env(?:ironment)?\s+)?(?:var(?:iable)?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:variable)?\b/i
			);
			if (envGet) {
				push('get_env_var', `Get env var ${envGet[1].toUpperCase()}`, {
					name: envGet[1].toUpperCase()
				});
			}
		}

		// Fallback: conversational.
		if (steps.length === 0) {
			push('chat', 'Conversational reply', { message: command });
		}

		return { steps };
	}
}
