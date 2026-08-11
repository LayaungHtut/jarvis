import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/**
 * Run a PowerShell script non-interactively and return trimmed stdout. The
 * script is passed as a single argv entry (no shell quoting), so multi-line
 * C# / Add-Type snippets work verbatim.
 */
export async function runPs(script: string, timeout = 15_000): Promise<string> {
	const { stdout } = await exec(
		'powershell',
		['-NoProfile', '-NonInteractive', '-Command', script],
		{ timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
	);
	return stdout.trim();
}
