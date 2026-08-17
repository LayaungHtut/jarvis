import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';
import { BrowserController } from '../browser/controller';

const exec = promisify(execFile);

/** C# COM shim for the CoreAudio API (verified to compile under Add-Type). */
const VOLUME_CS = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Vol {
	[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IAudioEndpointVolume {
		int RegisterControlChangeNotify(IntPtr p);
		int UnregisterControlChangeNotify(IntPtr p);
		int GetChannelCount(out int p);
		int SetMasterVolumeLevel(float f, ref Guid g);
		int SetMasterVolumeLevelScalar(float f, ref Guid g);
		int GetMasterVolumeLevel(out float f);
		int GetMasterVolumeLevelScalar(out float f);
		int SetChannelVolumeLevel(uint c, float f, ref Guid g);
		int SetChannelVolumeLevelScalar(uint c, float f, ref Guid g);
		int GetChannelVolumeLevel(uint c, out float f);
		int GetChannelVolumeLevelScalar(uint c, out float f);
		int SetMute(bool b, ref Guid g);
		int GetMute(out bool b);
		int GetVolumeStepInfo(uint s, out uint o);
		int VolumeStepUp(ref Guid g);
		int VolumeStepDown(ref Guid g);
		int QueryHardwareSupport(uint o);
		int GetVolumeRange(out float a, out float b, out float c);
	}
	[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IMMDevice {
		int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
		int OpenPropertyStore(int stgmAccess, IntPtr pp);
		int GetId(out IntPtr p);
		int GetState(out uint p);
	}
	[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IMMDeviceEnumerator {
		int EnumAudioEndpoints(int dataFlow, int deviceState, out IMMDeviceCollection devices);
		int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
	}
	[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	public interface IMMDeviceCollection {
		int GetCount(out int c);
		int Item(int n, out IMMDevice device);
	}
	[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
	public class CMMDeviceEnumerator { }
	private static IMMDevice GetDefaultEndpoint() {
		var enumerator = (IMMDeviceEnumerator)(object)new CMMDeviceEnumerator();
		IMMDevice device;
		int hr = enumerator.GetDefaultAudioEndpoint(0, 1, out device);
		if (hr != 0) throw new COMException("GetDefaultAudioEndpoint failed: 0x" + hr.ToString("X8"));
		return device;
	}
	private static IAudioEndpointVolume GetEndpointVolume() {
		IMMDevice device = GetDefaultEndpoint();
		Guid iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
		object o;
		int hr = device.Activate(ref iid, 3, IntPtr.Zero, out o);
		if (hr != 0) throw new COMException("Activate failed: 0x" + hr.ToString("X8"));
		return (IAudioEndpointVolume)o;
	}
	public static string GetLevel() {
		var v = GetEndpointVolume();
		float scalar;
		v.GetMasterVolumeLevelScalar(out scalar);
		return Math.Round(scalar * 100).ToString();
	}
	public static string SetLevel(int percent) {
		float scalar = Math.Max(0f, Math.Min(100f, percent)) / 100f;
		var v = GetEndpointVolume();
		Guid empty = Guid.Empty;
		v.SetMasterVolumeLevelScalar(scalar, ref empty);
		return GetLevel();
	}
}
"@
`.trim();

const MEDIA_VK: Record<string, number> = {
	play_pause: 0xb3,
	playpause: 0xb3,
	play: 0xb3,
	pause: 0xb3,
	next: 0xb0,
	'next track': 0xb0,
	previous: 0xb1,
	prev: 0xb1,
	'previous track': 0xb1,
	stop: 0xb2,
	mute: 0xad,
	unmute: 0xad
};

export function clampPercent(n: number): number {
	if (!Number.isFinite(n)) throw new Error('volume must be a number');
	return Math.max(0, Math.min(100, Math.round(n)));
}

async function readVolume(): Promise<number> {
	const out = await runPs(`${VOLUME_CS}\n[Vol]::GetLevel()`);
	const n = Number(out);
	if (!Number.isFinite(n)) throw new Error(`unexpected volume output "${out}"`);
	return n;
}

/** Read the current master volume percentage. */
export class GetVolumeTool extends Tool {
	name = 'get_volume';
	description = 'Return the current master volume percentage.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('get_volume requires Windows.');
		try {
			const level = await readVolume();
			return ok(`Volume is at ${level}%.`, { volume: level });
		} catch (err) {
			return fail('Failed to read volume.', (err as Error).message);
		}
	}
}

/** Set the master volume to an absolute percentage (0..100). */
export class SetVolumeTool extends Tool {
	name = 'set_volume';
	description = 'Set the master volume to a percentage between 0 and 100.';
	permissionLevel = 'medium' as const;
	parameters = [{ name: 'percent', type: 'number', description: 'Target volume 0..100.' }] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('set_volume requires Windows.');
		try {
			const percent = clampPercent(Number(args.percent));
			const out = await runPs(`${VOLUME_CS}\n[Vol]::SetLevel(${percent})`);
			return ok(`Volume set to ${out}%.`, { volume: Number(out) });
		} catch (err) {
			return fail('Failed to set volume.', (err as Error).message);
		}
	}
}

/** Adjust the volume by a signed delta percentage. */
export class AdjustVolumeTool extends Tool {
	name = 'adjust_volume';
	description = 'Adjust volume by a signed delta, e.g. +10 or -5 percent.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'delta', type: 'number', description: 'Signed percent change (e.g. 10 or -10).' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('adjust_volume requires Windows.');
		try {
			const delta = Number(args.delta);
			if (!Number.isFinite(delta)) return fail('delta must be a number.');
			const current = await readVolume();
			const target = clampPercent(current + delta);
			const out = await runPs(`${VOLUME_CS}\n[Vol]::SetLevel(${target})`);
			return ok(`Volume ${delta >= 0 ? 'up' : 'down'} to ${out}%.`, { volume: Number(out) });
		} catch (err) {
			return fail('Failed to adjust volume.', (err as Error).message);
		}
	}
}

/** Control playback: play/pause, next, previous, stop, mute. */
export class MediaControlTool extends Tool {
	name = 'media_control';
	description = 'Control media playback: play/pause, next, previous, stop, mute.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'action', type: 'string', description: 'play_pause | next | previous | stop | mute' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('media_control requires Windows.');
		const action = String(args.action ?? '').toLowerCase();
		const vk = MEDIA_VK[action];
		if (vk === undefined) return fail(`Unsupported action "${action}".`);
		try {
			const script = `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Mk {\n[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);\n}\n"@;\n[void][Mk]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero);\n[void][Mk]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero);\n"${action}"`;
			const out = await runPs(script);
			return ok(out || `Sent ${action}.`);
		} catch (err) {
			return fail(`Failed to send ${action}.`, (err as Error).message);
		}
	}
}

/** Extract the first 11-char YouTube video id from a search results page. */
export function extractVideoId(html: string): string | null {
	const match = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
	return match ? match[1] : null;
}

/** Open a YouTube URL in the default browser and trigger the play/pause media key. */
export function openAndPlayYouTube(url: string, query: string): Promise<string> {
	const vk = 0xb3;
	const script = `Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class Mk {\n[DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);\n}\n"@;\n[void][Mk]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero);\n[void][Mk]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero);\n"${query}"`;
	return runPs(script);
}

/**
 * Search YouTube for a song/artist, open the top result in the default
 * browser, and press the play/pause media key. Composes the previously
 * manual search → read → open → play chain into a single step.
 */
export class MediaPlayTool extends Tool {
	name = 'media_play';
	description =
		'Search YouTube for a song or artist, open the top result in the default browser, and start playback.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'query', type: 'string', description: 'Song title, artist, or search phrase.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('media_play requires Windows.');
		const query = requireString(args, 'query', 500);
		const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
		context.emit('TOOL_STARTED', { tool: this.name, query });
		const browser = new BrowserController();
		try {
			const html = await browser.readHtml(searchUrl, 15_000);
			const id = extractVideoId(html);
			if (!id) {
				return fail('No playable video found on YouTube for that query.', 'no video id');
			}
			const watch = `https://www.youtube.com/watch?v=${id}`;
			await exec('cmd', ['/c', 'start', '', watch], { windowsHide: true });
			await openAndPlayYouTube(watch, query);
			return ok(`Opened ${watch} and started playback.`, {
				query,
				url: watch,
				video_id: id
			});
		} catch (err) {
			return fail('Failed to play media.', (err as Error).message);
		} finally {
			await browser.close();
		}
	}
}

/** Show a Windows toast/balloon notification. */
export class NotifyTool extends Tool {
	name = 'show_notification';
	description = 'Show a Windows notification balloon with a title and message.';
	permissionLevel = 'low' as const;
	parameters = [
		{ name: 'title', type: 'string', description: 'Notification title.' },
		{ name: 'message', type: 'string', description: 'Notification body text.' }
	] as const;

	async execute(args: Record<string, unknown>): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('show_notification requires Windows.');
		const title = String(args.title ?? 'JARVIS').slice(0, 64);
		const message = String(args.message ?? '').slice(0, 256);
		if (!message) return fail('Missing message.');
		const t = title.replace(/'/g, "''");
		const m = message.replace(/'/g, "''");
		const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing\n$n = New-Object System.Windows.Forms.NotifyIcon\n$n.Icon = [System.Drawing.SystemIcons]::Information\n$n.Visible = $true\n$n.BalloonTipTitle = '${t}'\n$n.BalloonTipText = '${m}'\n$n.ShowBalloonTip(5000)\nStart-Sleep -Milliseconds 600\n$n.Dispose()`;
		try {
			await runPs(script, 20_000);
			return ok(`Notification shown.`, { title, message });
		} catch (err) {
			return fail('Failed to show notification.', (err as Error).message);
		}
	}
}

/** Lock the workstation. */
export class LockScreenTool extends Tool {
	name = 'lock_screen';
	description = 'Lock the Windows workstation immediately.';
	permissionLevel = 'high' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('lock_screen requires Windows.');
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: {}
		});
		if (!granted) return fail('Lock was denied by the user.');
		try {
			await runPs(`Start-Process rundll32.exe -ArgumentList 'user32.dll,LockWorkStation'`);
			return ok('Workstation locked.');
		} catch (err) {
			return fail('Failed to lock screen.', (err as Error).message);
		}
	}
}
