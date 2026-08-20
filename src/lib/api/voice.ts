/**
 * Browser voice utilities: speech recognition (mic input) and speech synthesis
 * (JARVIS speaking replies). Uses the Web Speech API available in Chrome/Edge.
 * All functions are browser-only and no-op on the server.
 */

export function speechRecognitionAvailable(): boolean {
	if (typeof window === 'undefined') return false;
	const w = window as unknown as Record<string, unknown>;
	return (
		typeof w.SpeechRecognition === 'function' || typeof w.webkitSpeechRecognition === 'function'
	);
}

export function speechSynthesisAvailable(): boolean {
	return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

type RecognitionCtor = new () => SpeechRecognition;

function getRecognition(): RecognitionCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		SpeechRecognition?: RecognitionCtor;
		webkitSpeechRecognition?: RecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface MicSession {
	stop(): void;
}

/**
 * Start continuous speech recognition. Resolves transcripts as they are
 * finalized; calls `onError` if recognition is unsupported or fails.
 */
export function startMic(
	onTranscript: (final: string, interim: string) => void,
	onEnd: () => void,
	onError: (message: string) => void
): MicSession | null {
	if (!speechRecognitionAvailable()) {
		onError('Speech recognition is not available in this browser. Use Chrome or Edge, sir.');
		return null;
	}

	const Ctor = getRecognition();
	if (!Ctor) return null;

	const recognition = new Ctor();
	recognition.lang = 'en-US';
	recognition.continuous = true;
	recognition.interimResults = true;

	recognition.onresult = (event: SpeechRecognitionEvent) => {
		let final = '';
		let interim = '';
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			if (result.isFinal) final += result[0].transcript;
			else interim += result[0].transcript;
		}
		onTranscript(final.trim(), interim.trim());
	};

	recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
		if (event.error === 'not-allowed')
			onError('Microphone access was denied, sir. Allow it and try again.');
		else if (event.error === 'no-speech') onError('I did not catch that, sir.');
		else if (event.error === 'network')
			onError('Speech service unreachable. Check your internet connection.');
		else onError(`Speech recognition error: ${event.error}`);
	};

	recognition.onend = () => {
		onEnd();
	};

	try {
		recognition.start();
	} catch {
		onError('Could not start the microphone, sir.');
		return null;
	}

	return { stop: () => recognition.stop() };
}

/**
 * Speak a line of text. Chunks long replies and keeps the voice consistent.
 * Returns false if speech synthesis is unavailable.
 */
export function speak(text: string, onEnd?: () => void): boolean {
	if (!speechSynthesisAvailable()) return false;
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) return false;

	const synth = window.speechSynthesis;
	synth.cancel();

	const sentences = clean.match(/[^.!?\n]+[.!?]*/g) ?? [clean];
	const chunks = sentences
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.reduce<string[]>((acc, sentence) => {
			const last = acc[acc.length - 1];
			if (last && (last + ' ' + sentence).length <= 180) {
				acc[acc.length - 1] = last + ' ' + sentence;
			} else {
				acc.push(sentence);
			}
			return acc;
		}, []);

	const utterance = new SpeechSynthesisUtterance(chunks.join(' '));
	const preferred = window.speechSynthesis
		.getVoices()
		.find((v) => /en[-_]US/i.test(v.lang) && /(zira|david|jenny|aria|natural)/i.test(v.name));
	if (preferred) utterance.voice = preferred;
	utterance.lang = 'en-US';
	utterance.rate = 1;
	utterance.pitch = 1;
	if (onEnd) utterance.onend = onEnd;
	synth.speak(utterance);
	return true;
}

/** Hard-stop any ongoing speech output. */
export function stopSpeaking(): void {
	if (speechSynthesisAvailable()) window.speechSynthesis.cancel();
}
