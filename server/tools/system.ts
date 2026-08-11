import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail } from './base';
import type { ToolResult } from './base';
import type { SystemInfo } from '../../src/lib/shared/types';

const exec = promisify(execFile);

/** Collect system metrics: CPU, RAM, disk, uptime, active window. */
export class SystemInfoTool extends Tool {
	name = 'system_info';
	description = 'Report current system status: CPU, memory, disk, uptime, active window.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		try {
			const info = await collectAdvanced();
			return ok('Collected system information.', info);
		} catch (err) {
			return fail('Failed to collect system information', (err as Error).message);
		}
	}
}

async function diskBytes(): Promise<{ total: number; free: number }> {
	if (process.platform !== 'win32') {
		const { statfs } = await import('node:fs/promises');
		const st = await statfs(process.cwd());
		const total = st.blocks * st.bsize;
		const free = st.bfree * st.bsize;
		return { total, free };
	}
	try {
		const { stdout } = await exec(
			'powershell',
			[
				'-NoProfile',
				'-Command',
				'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress'
			],
			{ timeout: 10_000, windowsHide: true }
		);
		const parsed = JSON.parse(stdout.trim());
		const disks = Array.isArray(parsed) ? parsed : [parsed];
		const total = disks.reduce((sum: number, d: { Size: string }) => sum + Number(d.Size || 0), 0);
		const free = disks.reduce(
			(sum: number, d: { FreeSpace: string }) => sum + Number(d.FreeSpace || 0),
			0
		);
		return { total, free };
	} catch {
		return { total: 0, free: 0 };
	}
}

async function activeWindow(): Promise<string | null> {
	if (process.platform !== 'win32') return null;
	try {
		const { stdout } = await exec(
			'powershell',
			[
				'-NoProfile',
				'-Command',
				'Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder t, int c); }\n"@; $h=[W]::GetForegroundWindow(); $t=New-Object System.Text.StringBuilder 512; [void][W]::GetWindowText($h,$t,$t.Capacity); $t.ToString()'
			],
			{ timeout: 10_000, windowsHide: true }
		);
		const title = stdout.trim();
		return title || null;
	} catch {
		return null;
	}
}

function processCount(): number {
	try {
		if (process.platform !== 'win32') return os.loadavg().length;
		return 0;
	} catch {
		return 0;
	}
}

export async function collectAdvanced(): Promise<SystemInfo> {
	const memTotal = os.totalmem();
	const memFree = os.freemem();
	const disk = await diskBytes();
	const win = await activeWindow();
	const cpus = os.cpus();
	const load = os.loadavg();

	return {
		platform: os.platform(),
		arch: os.arch(),
		hostname: os.hostname(),
		release: os.release(),
		uptime_seconds: Math.floor(os.uptime()),
		cpu_model: cpus[0]?.model ?? 'unknown',
		cpu_cores: cpus.length,
		cpu_load: load.map((n) => Number(n.toFixed(2))),
		memory_total: memTotal,
		memory_free: memFree,
		memory_used: memTotal - memFree,
		active_window: win,
		process_count: processCount(),
		disk_total: disk.total,
		disk_free: disk.free
	};
}
