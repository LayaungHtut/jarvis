<script lang="ts">
	import type { TaskState, ToolCallRecord } from '$lib/shared/types';

	let { task, busy }: { task: TaskState | null; busy: boolean } = $props();

	const stepStatus = (s: TaskState['plan'][number]['status']): string => {
		switch (s) {
			case 'running':
				return 'border-sky-400 bg-sky-400/10 text-sky-300';
			case 'completed':
				return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300';
			case 'failed':
				return 'border-red-500/50 bg-red-500/10 text-red-300';
			case 'skipped':
				return 'border-slate-600 bg-slate-800/40 text-slate-500';
			default:
				return 'border-slate-600 bg-slate-800/40 text-slate-300';
		}
	};
</script>

<div class="h-full overflow-y-auto px-4 py-3 font-mono text-sm">
	{#if !task}
		<p class="mt-2 text-center text-xs text-slate-500">
			{busy ? 'Analyzing request…' : 'No active task.'}
		</p>
	{:else}
		<header class="mb-3 border-b border-slate-800 pb-2">
			<p class="text-[10px] tracking-widest text-slate-500">TASK #{task.task_id.slice(0, 8)}</p>
			<h2 class="text-xs font-semibold text-slate-100">{task.user_request}</h2>
			<div class="mt-1 flex items-center gap-2">
				<span
					class="rounded-full border px-2 py-0.5 text-[10px] tracking-widest uppercase
						{busy ? 'border-sky-400/60 text-sky-300' : 'border-slate-600 text-slate-400'}"
				>
					{task.status}
				</span>
				<span class="text-[10px] text-slate-500">
					step {task.current_step}/{task.max_iterations}
				</span>
			</div>
		</header>

		{#if task.plan.length > 0}
			<section>
				<h3 class="mb-2 text-[10px] font-semibold tracking-widest text-slate-400">PLAN</h3>
				<ol class="space-y-2">
					{#each task.plan as step (step.id)}
						<li class="rounded border px-3 py-2 {stepStatus(step.status)}">
							<div class="flex items-baseline gap-2">
								<span class="shrink-0 text-[10px] text-slate-500">{step.index + 1}.</span>
								<span class="shrink-0 text-[10px] text-slate-400 uppercase">{step.tool}</span>
								{#if step.status === 'running'}
									<span class="ml-auto animate-pulse text-[10px] text-sky-300">RUN</span>
								{:else if step.status === 'completed'}
									<span class="ml-auto text-[10px] text-emerald-300">OK</span>
								{:else if step.status === 'failed'}
									<span class="ml-auto text-[10px] text-red-300">FAIL</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-slate-400">{step.description}</p>
							{#if step.result}
								<pre
									class="mt-2 max-h-40 overflow-auto rounded bg-black/40 p-2 text-[11px] whitespace-pre-wrap text-slate-300">{step.result}</pre>
							{/if}
						</li>
					{/each}
				</ol>
			</section>
		{/if}

		{#if task.tool_calls.length > 0}
			<section class="mt-4">
				<h3 class="mb-2 text-[10px] font-semibold tracking-widest text-slate-400">CALLS</h3>
				<ul class="space-y-1">
					{#each task.tool_calls as call (call.id)}
						{@const status: ToolCallRecord['status'] = call.status}
						<li class="flex items-center gap-2 text-xs">
							<span
								class="h-2 w-2 shrink-0 rounded-full
									{status === 'completed'
									? 'bg-emerald-400'
									: status === 'failed'
										? 'bg-red-400'
										: 'animate-pulse bg-sky-400'}"
							></span>
							<span class="text-slate-200">{call.tool}</span>
							<span class="ml-auto truncate text-[10px] text-slate-500">
								{JSON.stringify(call.arguments)}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if task.errors.length > 0}
			<section class="mt-4">
				<h3 class="mb-2 text-[10px] font-semibold tracking-widest text-red-400">ERRORS</h3>
				<ul class="space-y-1 text-xs text-red-300">
					{#each task.errors as err (err)}
						<li class="rounded border border-red-500/30 bg-red-500/10 px-2 py-1">{err}</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
