<script lang="ts">
	import type { ConversationMessage } from '$lib/shared/types';

	type Message = ConversationMessage;

	let { messages, loading }: { messages: Message[]; loading: boolean } = $props();

	let el: HTMLDivElement | null = null;
	let autoscroll = $state(true);

	const presented = $derived(messages.length);

	function attachLog(node: HTMLDivElement) {
		el = node;
	}

	$effect(() => {
		void presented;
		if (autoscroll && el) el.scrollTop = el.scrollHeight;
	});

	function roleClass(role: Message['role']): string {
		switch (role) {
			case 'user':
				return 'border-blue-500/40 bg-blue-500/10 text-blue-100';
			case 'assistant':
				return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100';
			default:
				return 'border-amber-500/40 bg-amber-500/10 text-amber-100';
		}
	}

	function roleLabel(role: Message['role']): string {
		return role === 'user' ? 'YOU' : role === 'assistant' ? 'JARVIS' : 'SYSTEM';
	}
</script>

<div
	{@attach attachLog}
	onscroll={() =>
		(autoscroll = (el?.scrollTop ?? 0) + (el?.clientHeight ?? 0) >= (el?.scrollHeight ?? 0) - 8)}
	class="h-full overflow-y-auto px-4 py-3 font-mono text-sm"
>
	{#if messages.length === 0}
		<p class="mt-2 text-center text-xs text-slate-500">
			No conversation yet. Ask JARVIS something.
		</p>
	{:else}
		<div class="space-y-3">
			{#each messages as msg (msg.id)}
				<div class="message flex gap-3">
					<span class="mt-0.5 shrink-0 text-[10px] tracking-widest text-slate-500">
						{roleLabel(msg.role)}
					</span>
					<div class="min-w-0 flex-1">
						<div
							class="rounded border {roleClass(
								msg.role
							)} px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap"
						>
							{msg.content}
						</div>
					</div>
				</div>
			{/each}
			{#if loading}
				<div class="flex gap-3">
					<span class="mt-0.5 shrink-0 text-[10px] tracking-widest text-slate-500">JARVIS</span>
					<div class="typing flex gap-1 px-2 py-3">
						<span></span><span></span><span></span>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.message {
		animation: slide-in 0.2s ease-out;
	}
	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 9999px;
		background: rgba(34, 211, 238, 0.7);
		animation: blink 1.2s infinite;
	}
	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes blink {
		0%,
		60%,
		100% {
			opacity: 0.2;
		}
		30% {
			opacity: 1;
		}
	}
</style>
