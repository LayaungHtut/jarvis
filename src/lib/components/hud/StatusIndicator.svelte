<script lang="ts">
	import type { AgentStatus } from '$lib/shared/types';

	let { status }: { status: AgentStatus } = $props();

	const labels: Record<AgentStatus, string> = {
		idle: 'IDLE',
		listening: 'LISTENING',
		wake: 'WAKE',
		processing: 'PROCESSING',
		thinking: 'THINKING',
		executing: 'EXECUTING',
		observing: 'OBSERVING',
		speaking: 'SPEAKING',
		error: 'ERROR'
	};

	const palettes: Record<AgentStatus, { ring: string; glow: string; text: string }> = {
		idle: { ring: 'border-cyan-600/60', glow: 'bg-cyan-500/10', text: 'text-cyan-300' },
		listening: { ring: 'border-emerald-400', glow: 'bg-emerald-400/20', text: 'text-emerald-300' },
		wake: { ring: 'border-amber-400', glow: 'bg-amber-400/20', text: 'text-amber-300' },
		processing: { ring: 'border-violet-400', glow: 'bg-violet-400/20', text: 'text-violet-300' },
		thinking: { ring: 'border-sky-400', glow: 'bg-sky-400/20', text: 'text-sky-300' },
		executing: { ring: 'border-blue-400', glow: 'bg-blue-400/20', text: 'text-blue-300' },
		observing: { ring: 'border-teal-400', glow: 'bg-teal-400/20', text: 'text-teal-300' },
		speaking: { ring: 'border-fuchsia-400', glow: 'bg-fuchsia-400/20', text: 'text-fuchsia-300' },
		error: { ring: 'border-red-500', glow: 'bg-red-500/20', text: 'text-red-400' }
	};

	const palette = $derived(palettes[status]);

	const active = $derived(
		status === 'listening' ||
			status === 'processing' ||
			status === 'thinking' ||
			status === 'executing' ||
			status === 'observing' ||
			status === 'speaking'
	);

	const isWake = $derived(status === 'wake');
</script>

<div class="flex flex-col items-center justify-center gap-6 select-none">
	<div class="relative h-56 w-56">
		<!-- Outer concentric rings -->
		<div class="absolute inset-0 rounded-full border border-slate-500/20"></div>
		<div class="absolute inset-4 rounded-full border border-slate-500/25"></div>

		<!-- Wake shockwave rings radiating outward -->
		{#if isWake}
			<div class="wake-ring absolute inset-0 rounded-full" style="animation-delay: 0s"></div>
			<div class="wake-ring absolute inset-0 rounded-full" style="animation-delay: 0.45s"></div>
			<div class="wake-ring absolute inset-0 rounded-full" style="animation-delay: 0.9s"></div>
			<div class="wake-ring absolute inset-0 rounded-full" style="animation-delay: 1.35s"></div>
		{/if}

		<!-- Glow halo -->
		<div
			class="absolute inset-2 rounded-full {palette.glow} blur-xl transition-colors duration-500 {isWake
				? 'wake-glow'
				: ''}"
		></div>

		<!-- Core orb -->
		<div
			class="absolute inset-10 rounded-full border-2 {palette.ring} flex items-center justify-center bg-slate-950/80 shadow-[0_0_40px_rgba(34,211,238,0.25)] transition-colors duration-500 {isWake
				? 'wake-core'
				: ''}"
		>
			<div
				class="h-3/5 w-3/5 rounded-full {palette.ring} border {isWake
					? 'border-amber-300 bg-amber-400/40'
					: ''}"
				class:animate-spin={active}
				class:animate-pulse={status === 'error' || active}
			></div>
		</div>

		<!-- Sweeping radar for listening/processing -->
		{#if status === 'listening' || status === 'processing'}
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

	/* Wake: rings radiating outward */
	.wake-ring {
		border: 1px solid rgba(251, 191, 36, 0.6);
		animation: wake-ring 1.8s ease-out infinite;
		pointer-events: none;
	}
	@keyframes wake-ring {
		0% {
			transform: scale(0.45);
			opacity: 0.9;
		}
		100% {
			transform: scale(1.5);
			opacity: 0;
		}
	}

	/* Wake: brightening halo */
	.wake-glow {
		animation: wake-glow 2.4s ease-in-out infinite;
	}
	@keyframes wake-glow {
		0%,
		100% {
			opacity: 0.6;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	/* Wake: heartbeat ignition of the core, plus a subtle tick */
	.wake-core {
		animation: wake-core 1.4s cubic-bezier(0.33, 1, 0.68, 1) infinite;
	}
	@keyframes wake-core {
		0%,
		100% {
			box-shadow: 0 0 20px rgba(251, 191, 36, 0.35);
			transform: scale(1);
		}
		18% {
			box-shadow: 0 0 60px 12px rgba(251, 191, 36, 0.55);
			transform: scale(1.12);
		}
		34% {
			box-shadow: 0 0 18px rgba(251, 191, 36, 0.3);
			transform: scale(0.98);
		}
		55% {
			box-shadow: 0 0 46px 8px rgba(251, 191, 36, 0.5);
			transform: scale(1.08);
		}
	}
</style>
