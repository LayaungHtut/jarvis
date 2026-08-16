<script lang="ts">
	import type { SystemInfo } from '$lib/shared/types';

	let { system, connected }: { system: SystemInfo | null; connected: boolean } = $props();

	function fmtBytes(bytes: number): string {
		if (!bytes && bytes !== 0) return '—';
		const gb = bytes / 1024 ** 3;
		return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
	}

	function fmtUptime(s: number): string {
		if (!s) return '—';
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}h ${m}m`;
	}

	function loadColor(v: number): string {
		return v < 0.5 ? 'text-emerald-300' : v < 0.85 ? 'text-amber-300' : 'text-red-400';
	}
</script>

<div class="h-full overflow-y-auto px-4 py-3 font-mono text-xs">
	{#if !system}
		<p class="mt-2 text-center text-xs text-slate-500">
			{connected ? 'Awaiting telemetry…' : 'Offline.'}
		</p>
	{:else}
		<div class="space-y-1.5">
			<div class="mb-2 flex items-center gap-2">
				<span class="h-2 w-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-red-500'}"></span>
				<span class="text-[10px] tracking-widest text-slate-500"
					>SYS-CORE {connected ? 'ONLINE' : 'OFFLINE'}</span
				>
			</div>

			<div class="grid grid-cols-2 gap-x-3">
				<p class="text-slate-500">platform</p>
				<p class="text-right text-slate-200">{system.platform} {system.arch}</p>

				<p class="text-slate-500">host</p>
				<p class="text-right text-slate-200">{system.hostname}</p>

				<p class="text-slate-500">uptime</p>
				<p class="text-right text-slate-200">{fmtUptime(system.uptime_seconds)}</p>

				<p class="text-slate-500">cpu</p>
				<p class="text-right text-slate-200">
					{system.cpu_model.split(' ')[0]} ×{system.cpu_cores}
				</p>

				<p class="text-slate-500">load</p>
				{#if system.cpu_load.length > 0}
					<div class="flex justify-end gap-1 text-slate-400">
						{#each system.cpu_load as l, i (i)}
							<span class={loadColor(l)}>{(l * 100).toFixed(0)}%</span>
						{/each}
					</div>
				{:else}
					<p class="text-right text-slate-400">—</p>
				{/if}

				<p class="text-slate-500">mem</p>
				<p class="text-right text-slate-200">
					{fmtBytes(system.memory_used)} / {fmtBytes(system.memory_total)}
				</p>

				<p class="text-slate-500">proc</p>
				<p class="text-right text-slate-200">{system.process_count}</p>

				<p class="text-slate-500">disk</p>
				<p class="text-right text-slate-200">
					{fmtBytes(Math.max(0, system.disk_total - system.disk_free))} / {fmtBytes(
						system.disk_total
					)}
				</p>

				<p class="text-slate-500">window</p>
				<p class="truncate text-right text-slate-200" title={system.active_window ?? ''}>
					{system.active_window ?? '—'}
				</p>
			</div>
		</div>
	{/if}
</div>
