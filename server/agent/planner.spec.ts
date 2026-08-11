import { describe, it, expect } from 'vitest';
import { Planner } from '../agent/planner';

describe('Planner', () => {
	const planner = new Planner();

	it('recognizes open_application for app launches', () => {
		const plan = planner.plan('open notepad');
		expect(plan.steps).toHaveLength(1);
		expect(plan.steps[0].tool).toBe('open_application');
		expect(plan.steps[0].args.application).toContain('notepad');
	});

	it('recognizes open_url for http targets', () => {
		const plan = planner.plan('open https://example.com');
		expect(plan.steps[0].tool).toBe('open_url');
		expect(plan.steps[0].args.url).toBe('https://example.com');
	});

	it('recognizes system_info for status questions', () => {
		const plan = planner.plan('what are the system specs');
		expect(plan.steps.some((s) => s.tool === 'system_info')).toBe(true);
	});

	it('recognizes list_windows', () => {
		const plan = planner.plan('what windows are open');
		expect(plan.steps.some((s) => s.tool === 'list_windows')).toBe(true);
	});

	it('recognizes write_file with content extraction', () => {
		const plan = planner.plan('create file hello.txt with content test-permission');
		const step = plan.steps.find((s) => s.tool === 'write_file');
		expect(step).toBeDefined();
		expect(step?.args.path).toBe('hello.txt');
		expect(step?.args.content).toBe('test-permission');
	});

	it('recognizes read_file', () => {
		const plan = planner.plan('read package.json');
		expect(plan.steps.some((s) => s.tool === 'read_file')).toBe(true);
	});

	it('falls back to chat for conversational input', () => {
		const plan = planner.plan('hello, how are you?');
		expect(plan.steps[0].tool).toBe('chat');
	});

	it('assigns ordered indices', () => {
		const plan = planner.plan('search for svelte 5');
		plan.steps.forEach((step, i) => expect(step.index).toBe(i));
	});

	it('routes close commands to close_window', () => {
		const plan = planner.plan('close notepad');
		expect(plan.steps[0].tool).toBe('close_window');
		expect(plan.steps[0].args.target).toContain('notepad');
	});

	it('routes kill commands to kill_process', () => {
		const plan = planner.plan('kill node.exe');
		expect(plan.steps[0].tool).toBe('kill_process');
		expect(plan.steps[0].args.target).toBe('node.exe');
	});

	it('routes volume to set_volume', () => {
		const plan = planner.plan('set volume to 40');
		expect(plan.steps.some((s) => s.tool === 'set_volume' && s.args.percent === 40)).toBe(true);
	});

	it('routes volume up to adjust_volume', () => {
		const plan = planner.plan('volume up');
		expect(plan.steps.some((s) => s.tool === 'adjust_volume' && s.args.delta === 10)).toBe(true);
	});

	it('routes mute to media_control', () => {
		const plan = planner.plan('mute');
		expect(plan.steps.some((s) => s.tool === 'media_control' && s.args.action === 'mute')).toBe(
			true
		);
	});

	it('routes copy text to clipboard_write', () => {
		const plan = planner.plan('copy hello world');
		expect(plan.steps.some((s) => s.tool === 'clipboard_write')).toBe(true);
	});

	it('routes file copy to copy_file', () => {
		const plan = planner.plan('copy file a.txt to b.txt');
		const step = plan.steps.find((s) => s.tool === 'copy_file');
		expect(step?.args.source).toBe('a.txt');
		expect(step?.args.destination).toBe('b.txt');
	});

	it('routes focus to focus_window', () => {
		const plan = planner.plan('focus chrome');
		expect(plan.steps.some((s) => s.tool === 'focus_window')).toBe(true);
	});

	it('routes lock screen', () => {
		const plan = planner.plan('lock the screen');
		expect(plan.steps.some((s) => s.tool === 'lock_screen')).toBe(true);
	});

	it('routes observe_screen for look-at-my-screen', () => {
		const plan = planner.plan('look at my screen');
		expect(plan.steps.some((s) => s.tool === 'observe_screen')).toBe(true);
	});

	it('routes ui_list for what-buttons questions', () => {
		const plan = planner.plan('what buttons are on screen');
		expect(plan.steps.some((s) => s.tool === 'ui_list')).toBe(true);
	});

	it('routes ui_click for quoted labels', () => {
		const plan = planner.plan('click "Save"');
		expect(plan.steps.some((s) => s.tool === 'ui_click' && s.args.name === 'save')).toBe(true);
	});

	it('routes ui_click for button phrases', () => {
		const plan = planner.plan('click the Send button');
		expect(plan.steps.some((s) => s.tool === 'ui_click')).toBe(true);
	});

	it('routes search_files for find-a-file', () => {
		const plan = planner.plan('find the file quarterly report');
		expect(plan.steps.some((s) => s.tool === 'search_files')).toBe(true);
	});

	it('routes system_power for shutdown', () => {
		const plan = planner.plan('shut down the computer');
		expect(plan.steps.some((s) => s.tool === 'system_power' && s.args.action === 'shutdown')).toBe(
			true
		);
	});

	it('routes system_power for sleep', () => {
		const plan = planner.plan('sleep');
		expect(plan.steps.some((s) => s.tool === 'system_power' && s.args.action === 'sleep')).toBe(
			true
		);
	});

	it('keeps lock screen on lock_screen', () => {
		const plan = planner.plan('lock the screen');
		expect(plan.steps.some((s) => s.tool === 'lock_screen')).toBe(true);
		expect(plan.steps.some((s) => s.tool === 'system_power')).toBe(false);
	});

	it('routes list_apps', () => {
		const plan = planner.plan('what apps do I have installed');
		expect(plan.steps.some((s) => s.tool === 'list_apps')).toBe(true);
	});

	it('routes system_services for restart-a-service', () => {
		const plan = planner.plan('restart the print spooler service');
		expect(
			plan.steps.some((s) => s.tool === 'system_services' && s.args.action === 'restart')
		).toBe(true);
	});

	it('routes set_env_var', () => {
		const plan = planner.plan('set MY_VAR to hello');
		expect(plan.steps.some((s) => s.tool === 'set_env_var' && s.args.name === 'MY_VAR')).toBe(true);
	});
});
