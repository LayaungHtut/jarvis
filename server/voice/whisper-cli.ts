import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { STTProvider } from './providers';
import { toBuffer } from './openai-whisper';
import { writeFile, unlink, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const exec = promisify(execFile);

export class WhisperCLIProvider implements STTProvider {
	readonly name = 'whisper-cli';

	async transcribe(audio: ArrayBuffer | Buffer, mime?: string): Promise<string> {
		const bin = process.env.WHISPER_BIN || 'whisper';
		const ext = (mime ?? '').toLowerCase().includes('webm') ? 'webm' : 'wav';
		const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
		const file = join(tmpdir(), `jarvis-stt-${stamp}.${ext}`);
		const outputDir = join(tmpdir(), `jarvis-stt-out-${stamp}`);
		await mkdir(outputDir, { recursive: true });
		await writeFile(file, toBuffer(audio));
		try {
			const { stdout } = await exec(
				bin,
				[file, '--output_format', 'txt', '--output_dir', outputDir, '--fp16', 'False'],
				{
					timeout: 120_000,
					windowsHide: true,
					env: process.env
				}
			);
			const outFile = join(outputDir, `${basename(file, extname(file))}.txt`);
			try {
				return (await readFile(outFile, 'utf8')).trim();
			} catch {
				// Fall back to the console transcript, stripping whisper's timestamps.
				return stdout
					.split('\n')
					.map((line) => line.replace(/^\[\d+:\d+[.:]\d+[^\]]*\]\s*/, '').trim())
					.filter(Boolean)
					.join(' ')
					.trim();
			}
		} finally {
			await unlink(file).catch(() => undefined);
			await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
