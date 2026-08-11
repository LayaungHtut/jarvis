import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Tool, ok, fail } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';

const exec = promisify(execFile);

const AWARE = `Add-Type @"\nusing System;\nusing System.Text;\nusing System.Runtime.InteropServices;\nusing System.Windows.Forms;\npublic class Obs {\n[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\n[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int c);\n[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);\n[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }\n}\n"@;`;

/**
 * Screen awareness: capture a screenshot plus the active window title, cursor
 * position and display resolution in one call so the agent can decide its next
 * click or keystroke.
 */
export class ObserveScreenTool extends Tool {
	name = 'observe_screen';
	description =
		'Capture the current display: screenshot path, active window, cursor position and resolution.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'filename', type: 'string', description: 'Optional PNG filename for the screenshot.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('observe_screen requires Windows.');
		const filename =
			typeof args.filename === 'string' && args.filename
				? args.filename
				: `observe-${Date.now()}.png`;
		const outDir = resolve(process.cwd(), 'data', 'screenshots');
		await mkdir(outDir, { recursive: true });
		const outPath = resolve(outDir, filename);

		const script = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
${AWARE}
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${outPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$h = [Obs]::GetForegroundWindow()
$t = New-Object System.Text.StringBuilder 512
[void][Obs]::GetWindowText($h, $t, $t.Capacity)
$p = New-Object -TypeName 'Obs+POINT'
[void][Obs]::GetCursorPos([ref]$p)
$v = New-Object System.Collections.Specialized.OrderedDictionary
$v['width'] = $b.Width
$v['height'] = $b.Height
$v['screen'] = $b
$v['capture'] = $b.Location
$v['cursor_x'] = $p.X
$v['cursor_y'] = $p.Y
$v['active_window'] = $t.ToString()
$v['path'] = '${outPath}'
$v | ConvertTo-Json -Compress
`.trim();

		try {
			const out = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
				timeout: 30_000,
				windowsHide: true,
				maxBuffer: 4 * 1024 * 1024
			});
			const parsed = JSON.parse(out.stdout.trim());
			const doc: {
				width: number;
				height: number;
				cursor_x: number;
				cursor_y: number;
				active_window: string;
				path: string;
			} = Array.isArray(parsed) ? parsed[0] : parsed;
			context.emit('SCREEN_CAPTURED', { path: doc.path });
			return ok(`Observed screen (${doc.width}x${doc.height}).`, {
				path: doc.path,
				width: doc.width,
				height: doc.height,
				cursor: { x: doc.cursor_x, y: doc.cursor_y },
				active_window: doc.active_window
			});
		} catch (err) {
			return fail('Failed to observe the screen.', (err as Error).message);
		}
	}
}
