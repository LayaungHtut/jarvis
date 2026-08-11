import type { STTProvider } from './providers';

export class OpenAIWhisperProvider implements STTProvider {
	readonly name = 'openai';

	async transcribe(audio: ArrayBuffer | Buffer, mime?: string): Promise<string> {
		const key = process.env.OPENAI_API_KEY;
		if (!key) throw new Error('OPENAI_API_KEY is not set.');
		const buf = toBuffer(audio);
		const form = new FormData();
		form.append('model', 'whisper-1');
		form.append(
			'file',
			new Blob([new Uint8Array(buf)], { type: mime ?? 'audio/webm' }),
			`audio.${extForMime(mime)}`
		);
		const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
			method: 'POST',
			headers: { Authorization: `Bearer ${key}` },
			body: form
		});
		if (!res.ok) throw new Error(`OpenAI transcription HTTP ${res.status}: ${await res.text()}`);
		const data = (await res.json()) as { text?: string };
		return data.text?.trim() ?? '';
	}
}

/** Map a browser MediaRecorder mime type to a Whisper-compatible file extension. */
export function extForMime(mime?: string): string {
	switch ((mime ?? '').toLowerCase()) {
		case 'audio/wav':
		case 'audio/x-wav':
			return 'wav';
		case 'audio/mpeg':
		case 'audio/mp3':
			return 'mp3';
		case 'audio/mp4':
			return 'm4a';
		case 'audio/ogg':
			return 'ogg';
		case 'audio/flac':
			return 'flac';
		case 'audio/aac':
			return 'aac';
		default:
			return 'webm';
	}
}

export function toBuffer(audio: ArrayBuffer | Buffer): Buffer {
	return Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
}
