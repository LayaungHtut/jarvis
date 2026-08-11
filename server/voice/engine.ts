import { VoiceStateMachine } from './state';
import type { TTSProvider, STTProvider, WakeWordProvider } from './providers';
import { resolveTTS, resolveSTT } from './providers';
import { EVENT } from '../../src/lib/shared/events';

export interface VoiceEngineDeps {
	onTranscription: (text: string) => void;
	emit: (event: string, payload?: unknown) => void;
	onSpeaking: (speaking: boolean) => void;
}

/**
 * VoiceEngine owns the mic→wake→STT→agent→TTS pipeline. In Stage 1 the wake
 * word must be enabled by an external provider; microphone capture arrives via
 * `transcribeAudio` from the HUD (MediaRecorder). TTS uses Windows System.Speech
 * by default and is interruptible when the wake word fires mid-utterance.
 */
export class VoiceEngine {
	private readonly machine: VoiceStateMachine;
	private stt: STTProvider | null = null;
	private tts: TTSProvider;
	private wake: WakeWordProvider | null = null;

	constructor(private readonly deps: VoiceEngineDeps) {
		this.machine = new VoiceStateMachine();
		this.machine.setListener({
			onPhase: () => this.deps.emit(EVENT.STATUS_CHANGED, { status: this.machine.toAgentStatus() }),
			onTranscription: (text) => {
				this.deps.emit(EVENT.TRANSCRIPTION_READY, { text });
				this.deps.emit(EVENT.WAKE_WORD_DETECTED, {});
				this.deps.onTranscription(text);
			}
		});
		this.tts = resolveTTS();
		void this.initProviders();
	}

	private async initProviders(): Promise<void> {
		this.stt = await resolveSTT();
		if (!this.stt) {
			this.deps.emit(EVENT.LOGGED, {
				level: 'warn',
				message:
					'No STT provider configured (set JARVIS_STT_PROVIDER=whisper-cli|openai). Microphone input disabled.'
			});
		}
	}

	get state(): VoiceStateMachine {
		return this.machine;
	}

	async setWakeWordProvider(provider: WakeWordProvider): Promise<void> {
		this.wake = provider;
		provider.onWake(() => {
			// Interrupt any active speech and wait for next command.
			this.deps.emit(EVENT.WAKE_WORD_DETECTED, {});
			this.machine.handleWake();
			setTimeout(() => this.machine.startListening(), 300);
		});
	}

	async transcribeAudio(audio: ArrayBuffer, mime?: string): Promise<string> {
		if (!this.stt) {
			const msg =
				'STT provider is not configured. Run with JARVIS_STT_PROVIDER=whisper-cli (installed Whisper) or openai (API key).';
			this.deps.emit(EVENT.LOGGED, { level: 'warn', message: msg });
			return '';
		}
		this.machine.stopListening();
		try {
			const text = await this.stt.transcribe(audio, mime);
			if (text) this.machine.deliverTranscription(text);
			return text;
		} catch (err) {
			this.machine.transition('idle');
			this.deps.emit(EVENT.LOGGED, {
				level: 'error',
				message: `STT failed: ${(err as Error).message}`
			});
			return '';
		}
	}

	async speak(text: string): Promise<void> {
		if (!text) return;
		this.deps.onSpeaking(true);
		this.deps.emit(EVENT.SPEECH_STARTED, { text });
		this.machine.startSpeaking();
		try {
			await this.tts.speak(text);
		} catch (err) {
			this.deps.emit(EVENT.LOGGED, {
				level: 'error',
				message: `TTS failed: ${(err as Error).message}`
			});
		} finally {
			this.deps.onSpeaking(false);
			this.deps.emit(EVENT.SPEECH_FINISHED, {});
			this.machine.finishSpeaking();
		}
	}

	startListening(): void {
		this.machine.startListening();
	}

	stopListening(): void {
		this.machine.stopListening();
	}
}
