/**
 * Voice provider abstractions for STT and TTS.
 *
 * Stage 1 ships the interfaces and a Windows TTS implementation using the
 * built-in System.Speech synthesizer (no extra deps). Wake-word detection and
 * microphone capture require user-installed binaries (e.g. Vosk or Whisper),
 * documented in README.md. The VoiceEngine will not fabricate results when a
 * provider is missing — it emits a clear diagnostic instead.
 */

export interface STTProvider {
	readonly name: string;
	/** Transcribe audio into text. `mime` is the browser MediaRecorder type (e.g. audio/webm). */
	transcribe(audio: ArrayBuffer | Buffer, mime?: string): Promise<string>;
}

export interface TTSProvider {
	readonly name: string;
	/** Speaks text aloud; resolves when playback completes. */
	speak(text: string): Promise<void>;
}

export interface WakeWordProvider {
	readonly name: string;
	/** Subscribe to wake-word events. Returns a dispose function. */
	onWake(cb: () => void): () => void;
}

/** Windows built-in TTS via System.Speech — no native dependencies. */
export class WindowsTTS implements TTSProvider {
	readonly name = 'windows';
	private current: { cmd: Promise<void> } | null = null;

	async speak(text: string): Promise<void> {
		if (!text || this.current) return;
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const exec = promisify(execFile);
		const script = this.escapeForPs(text);
		const task = exec('powershell', [
			'-NoProfile',
			'-Command',
			`Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${script}')`
		]);
		this.current = { cmd: task.then(() => undefined).catch(() => undefined) };
		try {
			await task;
		} finally {
			this.current = null;
		}
	}

	private escapeForPs(text: string): string {
		return text.replace(/'/g, "`'").replace(/[\r\n]+/g, ' ');
	}
}

export async function resolveSTT(provider?: string): Promise<STTProvider | null> {
	const name = provider ?? process.env.JARVIS_STT_PROVIDER ?? 'none';
	if (name === 'whisper-cli') {
		const { WhisperCLIProvider } = await import('./whisper-cli');
		return new WhisperCLIProvider();
	}
	if (name === 'openai') {
		const { OpenAIWhisperProvider } = await import('./openai-whisper');
		return new OpenAIWhisperProvider();
	}
	return null;
}

export function resolveTTS(provider?: string): TTSProvider {
	const name = provider ?? process.env.JARVIS_TTS_PROVIDER ?? 'windows';
	if (name === 'none') {
		return { name: 'none', speak: async () => undefined };
	}
	return new WindowsTTS();
}
