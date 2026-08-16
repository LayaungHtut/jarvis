<script lang="ts">
	import type { LogEntry } from '$lib/shared/types';

	let { logs }: { logs: LogEntry[] } = $props();

	let el: HTMLDivElement | null = null;
	let autoscroll = $state(true);

	const presented = $derived(logs.length);

	function attachLog(node: HTMLDivElement) {
		el = node;
	}

	$effect(() => {
		void presented;
		if (autoscroll && el) el.scrollTop = el.scrollHeight;
	});

	function levelColor(level: LogEntry['level']): string {
		switch (level) {
			case 'error':
				return 'text-red-400';
			case 'warn':
				return 'text-amber-300';
			case 'debug':
				return 'text-slate-400';
			default:
				return 'text-slate-300';
		}
	}

	function time(timestamp: string): string {
		const d = new Date(timestamp);
		if (isNaN(d.getTime())) return timestamp;
		return d.toLocaleTimeString([], {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<div
	{@attach attachLog}
	onscroll={() =>
		(autoscroll = (el?.scrollTop ?? 0) + (el?.clientHeight ?? 0) >= (el?.scrollHeight ?? 0) - 8)}
	class="h-full overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
>
	{#if logs.length === 0}
		<p class="mt-2 text-center text-xs text-slate-500">Awaiting system events…</p>
	{:else}
		{#each logs as entry (entry.id)}
			<div class="flex gap-2">
				<span class="shrink-0 text-slate-600">{time(entry.timestamp)}</span>
				<span class="w-2 shrink-0 {levelColor(entry.level)}">{entry.level[0]?.toUpperCase()}</span>
				{#if entry.tool}
					<span class="shrink-0 text-cyan-500/80">[{entry.tool}]</span>
				{/if}
				<span class="min-w-0 break-words {levelColor(entry.level)}">{entry.message}</span>
			</div>
		{/each}
	{/if}
</div>
