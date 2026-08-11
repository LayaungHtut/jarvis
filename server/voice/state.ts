import type { AgentStatus } from '../../src/lib/shared/types';

export type VoicePhase = 'idle' | 'listening' | 'wake' | 'processing' | 'speaking';

/**
 * VoiceStateMachine tracks the mic→wake→STT→agent→TTS lifecycle and asks the
 * UI to render the current phase. Stage 1 ships the state machine plus event
 * plumbing; concrete microphones/ASR/TTS providers plug in here.
 */
export class VoiceStateMachine {
	private phase: VoicePhase = 'idle';
	private onPhase: ((phase: VoicePhase) => void) | null = null;
	private onTranscription: ((text: string) => void) | null = null;
	private interrupted = false;

	setListener(listener: {
		onPhase: (p: VoicePhase) => void;
		onTranscription: (t: string) => void;
	}): void {
		this.onPhase = listener.onPhase;
		this.onTranscription = listener.onTranscription;
	}

	transition(to: VoicePhase): void {
		this.phase = to;
		this.onPhase?.(to);
	}

	getPhase(): VoicePhase {
		return this.phase;
	}

	handleWake(): void {
		this.interrupted = true; // allow interrupting any ongoing TTS
		this.transition('wake');
	}

	startListening(): void {
		this.transition('listening');
	}

	stopListening(): void {
		this.transition('processing');
	}

	deliverTranscription(text: string): void {
		if (!text.trim()) {
			this.transition('idle');
			return;
		}
		this.onTranscription?.(text);
		this.transition('processing');
	}

	startSpeaking(): void {
		this.transition('speaking');
	}

	finishSpeaking(): void {
		this.transition('idle');
	}

	shouldInterrupt(): boolean {
		const was = this.interrupted;
		this.interrupted = false;
		return was;
	}

	toAgentStatus(): AgentStatus {
		switch (this.phase) {
			case 'listening':
				return 'listening';
			case 'wake':
				return 'wake';
			case 'processing':
				return 'processing';
			case 'speaking':
				return 'speaking';
			default:
				return 'idle';
		}
	}
}
