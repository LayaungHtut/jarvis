<script lang="ts">
	import { jarvis } from '$lib/stores/jarvis.svelte';

	let { connected }: { connected: boolean } = $props();

	const listening = $derived(jarvis.listening);
	const transcribing = $derived(jarvis.transcribing);
	const transcript = $derived(jarvis.transcript);
	const micSupported = $derived(jarvis.micSupported);
	const pendingState = $derived(
		jarvis.status === 'listening' || jarvis.status === 'wake' || jarvis.status === 'processing'
	);
	const active = $derived(listening || pendingState);
	const voiceEnabled = $derived(jarvis.voiceEnabled);

	const btnClass = $derived.by(() => {
		const base =
			'flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40';
		return active
			? `${base} border-red-500/70 bg-red-500/15 text-red-300`
			: `${base} border-slate-700 text-slate-400`;
	});

	const voiceBtnClass = $derived(
		`flex items-center gap-1.5 rounded-full border px-3 py-2 font-mono text-[11px] tracking-widest transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
			voiceEnabled
				? 'border-emerald-600/60 bg-emerald-600/10 text-emerald-300'
				: 'border-slate-700 bg-slate-800/50 text-slate-500'
		}`
	);

	const dotClass = $derived.by(() =>
		active ? (listening ? 'bg-red-500 animate-pulse' : 'bg-red-500') : 'bg-slate-600'
	);
</script>

<div class="flex items-center justify-center gap-3 pb-3">
	{#if micSupported}
		<button
			onclick={() => jarvis.toggleListening()}
			disabled={!connected || transcribing}
			title={listening ? 'Stop listening' : 'Speak to JARVIS'}
			class={btnClass}
		>
			<span class="h-2.5 w-2.5 rounded-full {dotClass}"></span>
			{transcribing ? 'PROCESSING' : listening ? 'LISTENING' : 'MIC'}
		</button>
	{/if}

	<button
		onclick={() => jarvis.setVoice(!voiceEnabled)}
		disabled={!connected}
		title={voiceEnabled ? 'Mute voice replies' : 'Unmute voice replies'}
		class={voiceBtnClass}
	>
		<span class="text-[13px] leading-none">{voiceEnabled ? '🔊' : '🔇'}</span>
		{voiceEnabled ? 'VOICE' : 'MUTED'}
	</button>

	{#if transcript}
		<span class="max-w-[20rem] truncate font-mono text-[11px] text-amber-300/90">
			"{transcript}"
		</span>
	{/if}
</div>
