// Minimal Web Speech API type declarations for browsers that ship the
// SpeechRecognition API under a webkit prefix and are not covered by lib.dom.
declare global {
	interface SpeechRecognitionAlternative {
		transcript: string;
		confidence: number;
	}

	interface SpeechRecognitionResult {
		isFinal: boolean;
		length: number;
		[index: number]: SpeechRecognitionAlternative;
	}

	interface SpeechRecognitionResultList {
		length: number;
		[index: number]: SpeechRecognitionResult;
	}

	interface SpeechRecognitionEvent extends Event {
		resultIndex: number;
		results: SpeechRecognitionResultList;
	}

	type SpeechRecognitionErrorCode =
		| 'no-speech'
		| 'aborted'
		| 'audio-capture'
		| 'network'
		| 'not-allowed'
		| 'service-not-allowed'
		| 'bad-grammar'
		| 'language-not-supported';

	interface SpeechRecognitionErrorEvent extends Event {
		error: SpeechRecognitionErrorCode;
		message: string;
	}

	interface SpeechRecognition extends EventTarget {
		lang: string;
		continuous: boolean;
		interimResults: boolean;
		maxAlternatives: number;
		onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null;
		onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null;
		onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
		onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
		onend: ((this: SpeechRecognition, ev: Event) => void) | null;
		onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
		start(): void;
		stop(): void;
		abort(): void;
	}

	var SpeechRecognition: {
		prototype: SpeechRecognition;
		new (): SpeechRecognition;
	};

	interface Window {
		SpeechRecognition: typeof SpeechRecognition;
		webkitSpeechRecognition: typeof SpeechRecognition;
	}
}

export {};
