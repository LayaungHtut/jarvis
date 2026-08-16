<script lang="ts">
	import type { AgentStatus } from '$lib/shared/types';

	let { status }: { status: AgentStatus } = $props();

	const labels: Record<AgentStatus, string> = {
		idle: 'IDLE',
		processing: 'PROCESSING',
		thinking: 'THINKING',
		executing: 'EXECUTING',
		observing: 'OBSERVING',
		error: 'ERROR'
	};

	const palettes: Record<AgentStatus, { ring: string; glow: string; text: string }> = {
		idle: { ring: 'border-cyan-600/60', glow: 'bg-cyan-500/10', text: 'text-cyan-300' },
		processing: { ring: 'border-violet-400', glow: 'bg-violet-400/20', text: 'text-violet-300' },
		thinking: { ring: 'border-sky-400', glow: 'bg-sky-400/20', text: 'text-sky-300' },
		executing: { ring: 'border-blue-400', glow: 'bg-blue-400/20', text: 'text-blue-300' },
		observing: { ring: 'border-teal-400', glow: 'bg-teal-400/20', text: 'text-teal-300' },
		error: { ring: 'border-red-500', glow: 'bg-red-500/20', text: 'text-red-400' }
	};

	const palette = $derived(palettes[status]);

	const active = $derived(
		status === 'processing' ||
			status === 'thinking' ||
			status === 'executing' ||
			status === 'observing'
	);
</script>

<div class="flex flex-col items-center justify-center gap-6 select-none">
	<div class="relative h-56 w-56">
		<!-- Outer concentric rings -->
		<div class="absolute inset-0 rounded-full border border-slate-500/20"></div>
		<div class="absolute inset-4 rounded-full border border-slate-500/25"></div>

		<!-- Glow halo -->
		<div
			class="absolute inset-2 rounded-full {palette.glow} blur-xl transition-colors duration-500"
		></div>

		<!-- Core orb -->
		<div
			class="absolute inset-10 rounded-full border-2 {palette.ring} flex items-center justify-center bg-slate-950/80 shadow-[0_0_40px_rgba(34,211,238,0.25)] transition-colors duration-500"
		>
			<div
				class="h-3/5 w-3/5 rounded-full {palette.ring} border"
				class:animate-spin={active}
				class:animate-pulse={status === 'error' || active}
			></div>
		</div>

		<!-- Sweeping radar for processing -->
		{#if status === 'processing'}
			<div class="sweep absolute inset-4 rounded-full border border-transparent"></div>
		{/if}
	</div>

	<div class="text-center">
		<div
			class="text-2xl font-semibold tracking-[0.35em] {palette.text} transition-colors duration-300"
		>
			{labels[status]}
		</div>
	</div>
</div>

<style>
	.sweep {
		background: conic-gradient(from 0deg, rgba(34, 211, 238, 0.4), transparent 70deg);
		animation: sweep 2.4s linear infinite;
	}
	@keyframes sweep {
		to {
			transform: rotate(360deg);
		}
	}
</style>
