import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail } from './base';
import type { ToolResult } from './base';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVENT } from '../../src/lib/shared/events';
import type { AgentContext } from '../agent/context';

const exec = promisify(execFile);

/**
 * Capture a screenshot of the primary display using PowerShell + .NET. The
 * image path is included so a later vision pass can inspect pixels.
 */
export class ScreenshotTool extends Tool {
	name = 'take_screenshot';
	description = 'Capture a screenshot of the current screen and save it to the workspace.';
	permissionLevel = 'medium' as const;
	parameters = [
		{ name: 'filename', type: 'string', description: 'Output filename (PNG), e.g. screen.png.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const filename =
			typeof args.filename === 'string' && args.filename
				? args.filename
				: `screen-${Date.now()}.png`;
		const outDir = resolve(process.cwd(), 'data', 'screenshots');
		await mkdir(outDir, { recursive: true });
		const outPath = resolve(outDir, filename);
		if (process.platform !== 'win32') {
			return fail('take_screenshot currently requires Windows.', 'unsupported platform');
		}
		const script = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${outPath}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`;
		try {
			await exec('powershell', ['-NoProfile', '-Command', script], {
				timeout: 30_000,
				windowsHide: true
			});
			context.emit(EVENT.SCREEN_CAPTURED, { path: outPath });
			return ok(`Screenshot saved.`, { path: outPath, width: 0, height: 0 });
		} catch (err) {
			return fail('Failed to take screenshot.', (err as Error).message);
		}
	}
}
