import { describe, it, expect } from 'vitest';
import { Planner } from '../agent/planner';

describe('Planner', async () => {
	const planner = new Planner();

	it('recognizes open_application for app launches', async () => {
		const plan = await planner.plan('open notepad');
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps[0].args.application).toContain('notepad');
	});

	it('recognizes open_url for http targets', async () => {
		const plan = await planner.plan('open https://example.com');
		expect(plan.steps[0].tool).toBe('open_url');
		expect(plan.steps[0].args.url).toBe('https://example.com');
	});

	it('recognizes system_info for status questions', async () => {
		const plan = await planner.plan('what are the system specs');
		expect(plan.steps.some((s) => s.tool === 'system_info')).toBe(true);
	});

	it('recognizes list_windows', async () => {
		const plan = await planner.plan('what windows are open');
		expect(plan.steps.some((s) => s.tool === 'list_windows')).toBe(true);
	});

	it('recognizes list_windows for "list open windows"', async () => {
		const plan = await planner.plan('list open windows');
		expect(plan.steps.some((s) => s.tool === 'list_windows')).toBe(true);
		expect(plan.steps.some((s) => s.tool === 'open_application')).toBe(false);
	});

	it('recognizes write_file with content extraction', async () => {
		const plan = await planner.plan('create file hello.txt with content test-permission');
		const step = plan.steps.find((s) => s.tool === 'write_file');
		expect(step).toBeDefined();
		expect(step?.args.path).toBe('hello.txt');
		expect(step?.args.content).toBe('test-permission');
	});

	it('splits compound open+write into two steps', async () => {
		const plan = await planner.plan('open notepad and write file hello.txt with content hi');
		const tools = plan.steps.map((s) => s.tool);
		expect(tools).toContain('open_application');
		expect(tools).toContain('write_file');
		const open = plan.steps.find((s) => s.tool === 'open_application');
		expect(open?.args.application).toBe('notepad');
		const write = plan.steps.find((s) => s.tool === 'write_file');
		expect(write?.args.path).toBe('hello.txt');
		expect(write?.args.content).toBe('hi');
		expect(plan.steps).toHaveLength(2);
	});

	it('extracts a known app keyword from a verbose open target', async () => {
		const plan = await planner.plan('open new folder vs code on a new window');
		const step = plan.steps[0];
		expect(step.tool).toBe('open_application');
		expect(step.args.application).toBe('code');
	});

	it('splits compound verbose open+write and extracts the app', async () => {
		const plan = await planner.plan(
			'open new folder vs code on new window and write a portfolio .html'
		);
		const tools = plan.steps.map((s) => s.tool);
		expect(tools).toEqual(['open_application', 'write_file']);
		expect(plan.steps[0].args.application).toBe('code');
		expect(plan.steps[1].args.path).toBe('portfolio .html');
	});

	it('recognizes read_file', async () => {
		const plan = await planner.plan('read package.json');
		expect(plan.steps.some((s) => s.tool === 'read_file')).toBe(true);
	});

	it('falls back to chat for conversational input', async () => {
		const plan = await planner.plan('hello, how are you?');
		expect(plan.steps[0].tool).toBe('chat');
	});

	it('assigns ordered indices', async () => {
		const plan = await planner.plan('search for svelte 5');
		plan.steps.forEach((step, i) => expect(step.index).toBe(i));
	});

	it('routes close commands to close_window', async () => {
		const plan = await planner.plan('close notepad');
		expect(plan.steps[0].tool).toBe('close_window');
		expect(plan.steps[0].args.target).toContain('notepad');
	});

	it('routes kill commands to kill_process', async () => {
		const plan = await planner.plan('kill node.exe');
		expect(plan.steps[0].tool).toBe('kill_process');
		expect(plan.steps[0].args.target).toBe('node.exe');
	});

	it('routes volume to set_volume', async () => {
		const plan = await planner.plan('set volume to 40');
		expect(plan.steps.some((s) => s.tool === 'set_volume' && s.args.percent === 40)).toBe(true);
	});

	it('routes volume up to adjust_volume', async () => {
		const plan = await planner.plan('volume up');
		expect(plan.steps.some((s) => s.tool === 'adjust_volume' && s.args.delta === 10)).toBe(true);
	});

	it('routes mute to media_control', async () => {
		const plan = await planner.plan('mute');
		expect(plan.steps.some((s) => s.tool === 'media_control' && s.args.action === 'mute')).toBe(
			true
		);
	});

	it('routes copy text to clipboard_write', async () => {
		const plan = await planner.plan('copy hello world');
		expect(plan.steps.some((s) => s.tool === 'clipboard_write')).toBe(true);
	});

	it('routes file copy to copy_file', async () => {
		const plan = await planner.plan('copy file a.txt to b.txt');
		const step = plan.steps.find((s) => s.tool === 'copy_file');
		expect(step?.args.source).toBe('a.txt');
		expect(step?.args.destination).toBe('b.txt');
	});

	it('routes focus to focus_window', async () => {
		const plan = await planner.plan('focus chrome');
		expect(plan.steps.some((s) => s.tool === 'focus_window')).toBe(true);
	});

	it('routes lock screen', async () => {
		const plan = await planner.plan('lock the screen');
		expect(plan.steps.some((s) => s.tool === 'lock_screen')).toBe(true);
	});

	it('routes observe_screen for look-at-my-screen', async () => {
		const plan = await planner.plan('look at my screen');
		expect(plan.steps.some((s) => s.tool === 'observe_screen')).toBe(true);
	});

	it('routes ui_list for what-buttons questions', async () => {
		const plan = await planner.plan('what buttons are on screen');
		expect(plan.steps.some((s) => s.tool === 'ui_list')).toBe(true);
	});

	it('routes ui_click for quoted labels', async () => {
		const plan = await planner.plan('click "Save"');
		expect(plan.steps.some((s) => s.tool === 'ui_click' && s.args.name === 'save')).toBe(true);
	});

	it('routes ui_click for button phrases', async () => {
		const plan = await planner.plan('click the Send button');
		expect(plan.steps.some((s) => s.tool === 'ui_click')).toBe(true);
	});

	it('routes search_files for find-a-file', async () => {
		const plan = await planner.plan('find the file quarterly report');
		expect(plan.steps.some((s) => s.tool === 'search_files')).toBe(true);
	});

	it('routes system_power for shutdown', async () => {
		const plan = await planner.plan('shut down the computer');
		expect(plan.steps.some((s) => s.tool === 'system_power' && s.args.action === 'shutdown')).toBe(
			true
		);
	});

	it('routes system_power for sleep', async () => {
		const plan = await planner.plan('sleep');
		expect(plan.steps.some((s) => s.tool === 'system_power' && s.args.action === 'sleep')).toBe(
			true
		);
	});

	it('keeps lock screen on lock_screen', async () => {
		const plan = await planner.plan('lock the screen');
		expect(plan.steps.some((s) => s.tool === 'lock_screen')).toBe(true);
		expect(plan.steps.some((s) => s.tool === 'system_power')).toBe(false);
	});

	it('routes list_apps', async () => {
		const plan = await planner.plan('what apps do I have installed');
		expect(plan.steps.some((s) => s.tool === 'list_apps')).toBe(true);
	});

	it('routes system_services for restart-a-service', async () => {
		const plan = await planner.plan('restart the print spooler service');
		expect(
			plan.steps.some((s) => s.tool === 'system_services' && s.args.action === 'restart')
		).toBe(true);
	});

	it('routes set_env_var', async () => {
		const plan = await planner.plan('set MY_VAR to hello');
		expect(plan.steps.some((s) => s.tool === 'set_env_var' && s.args.name === 'MY_VAR')).toBe(true);
	});
});

describe('Planner new behaviors', async () => {
	const planner = new Planner();

	it('captures a specific query for media_play', async () => {
		const plan = await planner.plan('play music from me eain shin');
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0].tool).toBe('media_play');
		expect(plan.steps[0].args.query).toBe('me eain shin');
	});

	it('captures a song+artist for media_play', async () => {
		const plan = await planner.plan('play bohemian rhapsody by queen');
		expect(plan.steps[0].tool).toBe('media_play');
		expect(plan.steps[0].args.query).toBe('bohemian rhapsody by queen');
	});

	it('routes generic play music to media_control play_pause', async () => {
		const plan = await planner.plan('play music');
		expect(plan.steps[0].tool).toBe('media_control');
		expect(plan.steps[0].args.action).toBe('play_pause');
	});

	it('routes control verbs to media_control actions', async () => {
		const next = await planner.plan('play next track');
		expect(next.steps[0].tool).toBe('media_control');
		expect(next.steps[0].args.action).toBe('next');
		const pause = await planner.plan('pause');
		expect(pause.steps[0].tool).toBe('media_control');
		expect(pause.steps[0].args.action).toBe('play_pause');
	});

	it('splits "then" chains into ordered steps', async () => {
		const plan = await planner.plan('open notepad then close calculator');
		expect(plan.steps.map((s) => s.tool)).toEqual(['open_application', 'close_window']);
		expect(plan.steps[0].args.application).toBe('notepad');
		expect(plan.steps[1].args.target).toContain('calculator');
	});

	it('splits "and" chains into ordered steps', async () => {
		const plan = await planner.plan('open chrome and read package.json');
		expect(plan.steps.map((s) => s.tool)).toEqual(['open_application', 'read_file']);
		expect(plan.steps[0].args.application).toBe('chrome');
		expect(plan.steps[1].args.path).toBe('package.json');
	});

	it('planAlternatives keeps the surviving segment of a chain', async () => {
		const alt = await planner.planAlternatives('open chrome and read package.json', [
			'open_application'
		]);
		expect(alt.steps.map((s) => s.tool)).toEqual(['read_file']);
	});

	it('planAlternatives returns empty when every tool is excluded', async () => {
		const alt = await planner.planAlternatives('play bohemian rhapsody by queen', ['media_play']);
		expect(alt.steps).toHaveLength(0);
	});

	it('asks a clarifying question instead of guessing on verb-only input', async () => {
		const open = await planner.plan('open');
		expect(open.steps[0].tool).toBe('chat');
		expect(open.steps[0].args.message).toBe('Which app, file, or URL would you like me to open?');
		const search = await planner.plan('search');
		expect(search.steps[0].args.message).toBe('What would you like me to search for?');
	});

	it('still falls back to plain chat for conversational input', async () => {
		const plan = await planner.plan('hello there');
		expect(plan.steps[0].tool).toBe('chat');
		expect(plan.steps[0].args.message).toBe('hello there');
	});

	it('learns friendly-name aliases at runtime via asserta', async () => {
		const learner = new Planner();
		expect(await learner.learnAppAlias('my editor', 'code')).toBe(true);
		const plan = await learner.plan('open my editor');
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps[0].args.application).toBe('code');
	});

	it('tolerates one-edit typos in app names', async () => {
		const plan = await planner.plan('open chrme');
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps[0].args.application).toBe('chrome');
		const notepad = await planner.plan('open notpad');
		expect(notepad.steps[0].args.application).toBe('notepad');
	});

	it('classifies risk from command content', async () => {
		expect(await planner.risk('shut down the computer')).toBe('critical');
		expect(await planner.risk('restart my pc')).toBe('critical');
		expect(await planner.risk('format the disk')).toBe('critical');
		expect(await planner.risk('taskkill notepad')).toBe('high');
		expect(await planner.risk('log off')).toBe('high');
		expect(await planner.risk('sleep')).toBe('low');
		expect(await planner.risk('play music')).toBe('low');
	});
});

describe('Planner extended capabilities', async () => {
	const planner = new Planner();

	it('routes "open the folder X" to open_path', async () => {
		const plan = await planner.plan('open the folder src');
		expect(plan.steps[0].tool).toBe('open_path');
		expect(plan.steps[0].args.path).toBe('src');
	});

	it('does not hijack app launches that mention "folder"', async () => {
		const plan = await planner.plan('open new folder vs code on a new window');
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps[0].args.application).toBe('code');
	});

	it('routes list directory questions to list_dir', async () => {
		const plan = await planner.plan('list files in src');
		expect(plan.steps[0].tool).toBe('list_dir');
		expect(plan.steps[0].args.path).toBe('src');
	});

	it('routes "what files are in X" to list_dir', async () => {
		const plan = await planner.plan('what files are in src');
		expect(plan.steps[0].tool).toBe('list_dir');
		expect(plan.steps[0].args.path).toBe('src');
	});

	it('routes list processes (with filter) to list_processes', async () => {
		const plain = await planner.plan('what processes are running');
		expect(plain.steps[0].tool).toBe('list_processes');
		const filtered = await planner.plan('list processes named chrome');
		expect(filtered.steps[0].tool).toBe('list_processes');
		expect(filtered.steps[0].args.filter).toBe('chrome');
	});

	it('routes volume questions to get_volume', async () => {
		const plan = await planner.plan('what is the current volume');
		expect(plan.steps[0].tool).toBe('get_volume');
	});

	it('routes active-window questions to get_active_window', async () => {
		const plan = await planner.plan('which window is on top');
		expect(plan.steps[0].tool).toBe('get_active_window');
	});

	it('routes remember/recall to the memory tools', async () => {
		const remember = await planner.plan('remember that my name is jarvis');
		expect(remember.steps[0].tool).toBe('remember');
		expect(remember.steps[0].args.content).toBe('my name is jarvis');
		const recall = await planner.plan('do you remember my birthday');
		expect(recall.steps[0].tool).toBe('recall');
		expect(recall.steps[0].args.query).toBe('my birthday');
	});

	it('routes url reads to read_page instead of read_file', async () => {
		const plan = await planner.plan('read https://example.com');
		expect(plan.steps[0].tool).toBe('read_page');
		expect(plan.steps[0].args.url).toBe('https://example.com');
	});

	it('routes minimize to minimize_window', async () => {
		const plan = await planner.plan('minimize the chrome window');
		expect(plan.steps[0].tool).toBe('minimize_window');
		expect(plan.steps[0].args.target).toContain('chrome');
	});

	it('routes notify to show_notification', async () => {
		const plan = await planner.plan('notify me that the build finished');
		expect(plan.steps[0].tool).toBe('show_notification');
		expect(plan.steps[0].args.message).toBe('the build finished');
	});

	it('routes move/rename to move_file', async () => {
		const plan = await planner.plan('move hello.txt into docs');
		expect(plan.steps[0].tool).toBe('move_file');
		expect(plan.steps[0].args.source).toBe('hello.txt');
		expect(plan.steps[0].args.destination).toBe('docs');
	});

	it('routes zip to zip_folder', async () => {
		const plan = await planner.plan('zip the folder src into backup.zip');
		expect(plan.steps[0].tool).toBe('zip_folder');
		expect(plan.steps[0].args.source).toBe('src');
		expect(plan.steps[0].args.archive).toBe('backup.zip');
	});

	it('routes delete file to delete_file', async () => {
		const plan = await planner.plan('delete file temp.txt');
		expect(plan.steps[0].tool).toBe('delete_file');
		expect(plan.steps[0].args.path).toBe('temp.txt');
	});

	it('routes press/scroll to their tools', async () => {
		const press = await planner.plan('press the tab key');
		expect(press.steps[0].tool).toBe('press_key');
		expect(press.steps[0].args.combo).toBe('tab');
		const scroll = await planner.plan('scroll down 3');
		expect(scroll.steps[0].tool).toBe('scroll_wheel');
		expect(scroll.steps[0].args.direction).toBe('down');
		expect(scroll.steps[0].args.clicks).toBe(3);
	});

	it('routes fill-field to ui_set_text', async () => {
		const plan = await planner.plan('type hello into the search field');
		expect(plan.steps[0].tool).toBe('ui_set_text');
		expect(plan.steps[0].args.name).toBe('search');
		expect(plan.steps[0].args.text).toBe('hello');
	});

	it('keeps plain typing on type_text', async () => {
		const plan = await planner.plan('type hello world');
		expect(plan.steps[0].tool).toBe('type_text');
	});
});

describe('Planner fuzzy app interpretation', async () => {
	const planner = new Planner();

	const cases: Array<[string, string]> = [
		['open telegram', 'telegram'],
		['open tele gram', 'telegram'],
		['open telehram', 'telegram'],
		['open telegrm', 'telegram'],
		['open chrome', 'chrome'],
		['open chorme', 'chrome'],
		['open spotify', 'spotify'],
		['open spootify', 'spotify'],
		['open terminal', 'terminal'],
		['open termianl', 'terminal']
	];

	it('interprets typos and split words into the canonical app name', async () => {
		for (const [cmd, app] of cases) {
			const plan = await planner.plan(cmd);
			expect(plan.steps[0].tool).toBe('open_application');
			expect(plan.steps[0].args.application).toBe(app);
		}
	});
});

describe('Planner google accounts', async () => {
	const planner = new Planner();

	const cases: Array<[string, string]> = [
		['open shirogami ryuu google account', 'shirogami ryuu'],
		['open shirogami ryuu google acc', 'shirogami ryuu'],
		['open google account shirogami ryuu', 'shirogami ryuu'],
		['switch to shirogami ryuu gmail account', 'shirogami ryuu'],
		['open my shirogami ryuu gmail acc', 'shirogami ryuu'],
		['open shirogami.ryuu@gmail.com', 'shirogami.ryuu@gmail.com']
	];

	it('routes google/gmail account phrases to open_google_account', async () => {
		for (const [cmd, account] of cases) {
			const plan = await planner.plan(cmd);
			expect(plan.steps).toHaveLength(1);
			expect(plan.steps[0].tool).toBe('open_google_account');
			expect(plan.steps[0].args.account).toBe(account);
			expect(plan.steps.some((s) => s.tool === 'open_application')).toBe(false);
		}
	});

	it('keeps real app launches on open_application', async () => {
		const plan = await planner.plan('open chrome');
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps.some((s) => s.tool === 'open_google_account')).toBe(false);
	});
});
