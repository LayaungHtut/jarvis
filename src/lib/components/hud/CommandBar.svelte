<script lang="ts">
	let {
		busy,
		connected,
		trusted,
		onSend,
		onStop,
		onToggleTrust
	}: {
		busy: boolean;
		connected: boolean;
		trusted: boolean;
		onSend: (text: string) => void;
		onStop: () => void;
		onToggleTrust: () => void;
	} = $props();

	let draft = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

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
</script>

<div class="flex items-center gap-3 border-t border-slate-800 px-4 py-3">
	<input
		bind:value={draft}
		{@attach attachInput}
		type="text"
		placeholder={connected ? 'Command JARVIS, sir…' : 'Connecting to JARVIS core…'}
		disabled={!connected}
		class="flex-1 rounded border border-slate-700 bg-slate-900/80 px-4 py-2.5 font-mono text-sm text-slate-100 transition-colors outline-none placeholder:text-slate-600 focus:border-cyan-500/70"
		onkeydown={keydown}
	/>

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
		onclick={onStop}
		disabled={!busy}
		class="rounded border border-red-500/60 bg-red-500/10 px-4 py-2.5 font-mono text-sm font-semibold tracking-widest text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
	>
		HALT
	</button>
</div>
