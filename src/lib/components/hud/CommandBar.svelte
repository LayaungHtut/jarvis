<script lang="ts">
	import { speechRecognitionAvailable, startMic, type MicSession } from '$lib/api/voice';

	let {
		busy,
		connected,
		trusted,
		voiceEnabled,
		onSend,
		onStop,
		onToggleTrust,
		onToggleVoice
	}: {
		busy: boolean;
		connected: boolean;
		trusted: boolean;
		voiceEnabled: boolean;
		onSend: (text: string) => void;
		onStop: () => void;
		onToggleTrust: () => void;
		onToggleVoice: () => void;
	} = $props();

	let draft = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let listening = $state(false);
	let micError = $state('');
	let micSession: MicSession | null = null;
	const micSupported = $derived(speechRecognitionAvailable());

	function attachInput(node: HTMLInputElement) {
		inputEl = node;
	}

	function submit(): void {
		if (!draft.trim()) return;
		onSend(draft);
		draft = '';
		inputEl?.focus();
	}

	function keydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}

	function startListening(): void {
		if (!micSupported || listening) return;
		micError = '';
		let buffer = '';
		micSession = startMic(
			(final, interim) => {
				if (final) {
					buffer = buffer ? `${buffer} ${final}` : final;
					draft = buffer;
				} else if (interim) {
					draft = buffer ? `${buffer} ${interim}` : interim;
				}
			},
			() => {
				listening = false;
				micSession = null;
				if (buffer.trim()) {
					onSend(buffer.trim());
					draft = '';
					buffer = '';
				}
			},
			(message) => {
				micError = message;
				listening = false;
				micSession = null;
			}
		);
		if (micSession) listening = true;
	}

	function stopListening(): void {
		micSession?.stop();
		micSession = null;
		listening = false;
	}

	function toggleMic(): void {
		if (listening) stopListening();
		else startListening();
	}
</script>

<div class="flex items-center gap-3 border-t border-slate-800 px-4 py-3">
	<input
		bind:value={draft}
		{@attach attachInput}
		type="text"
		placeholder={listening
			? 'Listening, sir…'
			: micError
				? micError
				: connected
					? 'Command JARVIS, sir…'
					: 'Connecting to JARVIS core…'}
		disabled={!connected || listening}
		class="flex-1 rounded border border-slate-700 bg-slate-900/80 px-4 py-2.5 font-mono text-sm text-slate-100 transition-colors outline-none placeholder:text-slate-600 focus:border-cyan-500/70"
		onkeydown={keydown}
	/>

	<button
		onclick={toggleMic}
		disabled={!connected || !micSupported}
		title={micSupported ? 'Speak a command' : 'Voice input requires Chrome or Edge'}
		class={`rounded border px-4 py-2.5 font-mono text-sm font-semibold tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
			listening
				? 'animate-pulse border-red-400/80 bg-red-500/20 text-red-300 shadow-[0_0_14px_rgba(248,113,113,0.4)]'
				: 'border-slate-600 bg-slate-800/60 text-slate-400 hover:border-red-500/60 hover:text-red-300'
		}`}
	>
		{listening ? '● LIVE' : 'MIC'}
	</button>

	<button
		onclick={submit}
		disabled={!connected || busy}
		class="rounded border border-cyan-500/60 bg-cyan-500/10 px-5 py-2.5 font-mono text-sm font-semibold tracking-widest text-cyan-300 transition-all hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
	>
		EXEC
	</button>

	<button
		onclick={onToggleTrust}
		disabled={!connected}
		class={`rounded border px-4 py-2.5 font-mono text-sm font-semibold tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
			trusted
				? 'border-amber-400/80 bg-amber-400/20 text-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.35)] hover:bg-amber-400/30'
				: 'border-slate-600 bg-slate-800/60 text-slate-400 hover:border-amber-500/60 hover:text-amber-300'
		}`}
		title={trusted
			? 'Trusted session: JARVIS acts without asking. Click to revoke.'
			: 'Trusted session: let JARVIS act without asking. Click to enable.'}
	>
		{trusted ? 'TRUSTED' : 'TRUST'}
	</button>

	<button
		onclick={onToggleVoice}
		disabled={!connected}
		title={voiceEnabled
			? 'JARVIS voice replies on. Click to mute.'
			: 'JARVIS voice replies off. Click to unmute.'}
		class={`rounded border px-4 py-2.5 font-mono text-sm font-semibold tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
			voiceEnabled
				? 'border-cyan-400/80 bg-cyan-400/20 text-cyan-300 hover:bg-cyan-400/30'
				: 'border-slate-600 bg-slate-800/60 text-slate-500 hover:border-cyan-500/60 hover:text-cyan-300'
		}`}
	>
		{voiceEnabled ? 'VOICE' : 'MUTED'}
	</button>

	<button
		onclick={onStop}
		disabled={!busy}
		class="rounded border border-red-500/60 bg-red-500/10 px-4 py-2.5 font-mono text-sm font-semibold tracking-widest text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
	>
		HALT
	</button>
</div>
