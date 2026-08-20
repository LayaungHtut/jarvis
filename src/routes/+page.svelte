<script lang="ts">
	import { onMount } from 'svelte';
	import { jarvis } from '$lib/stores/jarvis.svelte';
	import JarvisOrb from '$lib/components/hud/JarvisOrb.svelte';
	import ConversationPanel from '$lib/components/hud/ConversationPanel.svelte';
	import TaskPanel from '$lib/components/hud/TaskPanel.svelte';
	import SystemPanel from '$lib/components/hud/SystemPanel.svelte';
	import LogPanel from '$lib/components/hud/LogPanel.svelte';
	import CommandBar from '$lib/components/hud/CommandBar.svelte';
	import CodeWriterPanel from '$lib/components/hud/CodeWriterPanel.svelte';

	const conversation = $derived(jarvis.conversation);
	const task = $derived(jarvis.task);
	const system = $derived(jarvis.system);
	const logs = $derived(jarvis.logs);
	const writtenFiles = $derived(jarvis.writtenFiles);
	const status = $derived(jarvis.status);
	const busy = $derived(jarvis.busy);
	const connected = $derived(jarvis.connection === 'connected');
	const pendingPermission = $derived(jarvis.pendingPermission);

	let codeView = $state(false);

	onMount(() => {
		jarvis.connect();
		return () => jarvis.disconnect();
	});
</script>

<svelte:head>
	<title>JARVIS — Core Systems Online</title>
</svelte:head>

<div class="h-screen bg-[#020617] text-slate-100">
	<!-- Header -->
	<header class="flex items-center justify-between border-b border-slate-800/80 px-6 py-3">
		<div class="flex items-baseline gap-3">
			<h1
				class="text-xl font-bold tracking-[0.3em] text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]"
			>
				JARVIS
			</h1>
			<span class="text-[10px] tracking-widest text-slate-500">AUTONOMOUS CORE SYSTEMS</span>
		</div>
		<div class="flex items-center gap-2 text-[10px] tracking-widest">
			<span class={connected ? 'text-emerald-400' : 'text-red-400'}
				>{connected ? 'CHANNEL ONLINE' : 'CHANNEL OFFLINE'}</span
			>
			<span
				class="h-2 w-2 rounded-full {connected ? 'bg-emerald-400' : 'bg-red-500'}"
				class:animate-pulse={!connected}
			></span>
			<button
				onclick={() => (codeView = true)}
				class="ml-3 rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-widest text-cyan-300 transition hover:bg-cyan-500/20"
			>
				◉ LIVE CODE
			</button>
		</div>
	</header>

	<!-- Permission modal -->
	{#if pendingPermission}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div
				class="w-full max-w-md rounded border border-amber-500/40 bg-slate-950 p-6 shadow-[0_0_40px_rgba(245,158,11,0.15)]"
			>
				<h2 class="mb-1 font-mono text-sm font-semibold tracking-widest text-amber-400">
					PERMISSION REQUEST
				</h2>
				<p class="mb-3 font-mono text-[11px] text-slate-400">
					Tool <span class="text-amber-300">{pendingPermission.tool}</span> requires {pendingPermission.level.toUpperCase()}
					clearance
				</p>
				<pre
					class="mb-4 max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-slate-300">{JSON.stringify(
						pendingPermission.arguments,
						null,
						2
					)}</pre>
				<div class="flex justify-end gap-3">
					<button
						onclick={() => jarvis.respondPermission(pendingPermission.request_id, false)}
						class="rounded border border-slate-700 px-4 py-2 font-mono text-xs tracking-widest text-slate-400 hover:bg-slate-800/60"
					>
						DENY
					</button>
					<button
						onclick={() => jarvis.respondPermission(pendingPermission.request_id, true)}
						class="rounded border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 font-mono text-xs font-semibold tracking-widest text-emerald-300 hover:bg-emerald-500/20"
					>
						GRANT
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Live code view overlay -->
	{#if codeView}
		<div class="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
			<div
				class="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/90 px-6 py-3"
			>
				<h2 class="font-mono text-sm font-bold tracking-[0.25em] text-cyan-400">
					LIVE CODE — WATCH JARVIS WRITE
				</h2>
				<button
					onclick={() => (codeView = false)}
					class="rounded border border-slate-700 px-4 py-1.5 font-mono text-xs tracking-widest text-slate-300 transition hover:bg-slate-800/60"
				>
					CLOSE ✕
				</button>
			</div>
			<div class="min-h-0 flex-1 p-4">
				<CodeWriterPanel files={writtenFiles} {logs} {connected} />
			</div>
		</div>
	{/if}

	<!-- Body -->
	<main class="flex h-[calc(100vh-4.25rem)] flex-col">
		<div class="grid min-h-0 flex-1 grid-cols-12 grid-rows-[minmax(0,1fr)]">
			<!-- Left: conversation -->
			<section class="col-span-4 flex min-h-0 flex-col border-r border-slate-800/80">
				<div class="panel-label">CONVERSATION</div>
				<div class="min-h-0 flex-1">
					<ConversationPanel messages={conversation} loading={busy && conversation.length === 0} />
				</div>
			</section>

			<!-- Center: orb + command -->
			<section class="col-span-4 flex min-h-0 flex-col">
				<div class="flex min-h-0 flex-1 items-center justify-center">
					<JarvisOrb {status} />
				</div>
				<div>
					<CommandBar
						{busy}
						{connected}
						trusted={jarvis.trusted}
						voiceEnabled={jarvis.voiceEnabled}
						onSend={(t) => jarvis.send(t)}
						onStop={() => jarvis.stop()}
						onToggleTrust={() => jarvis.setTrusted(!jarvis.trusted)}
						onToggleVoice={() => jarvis.toggleVoice()}
					/>
				</div>
			</section>

			<!-- Right: task + system -->
			<section class="col-span-4 flex min-h-0 flex-col border-l border-slate-800/80">
				<div class="flex min-h-0 flex-1 flex-col">
					<div class="panel-label">TASK</div>
					<div class="min-h-0 flex-1">
						<TaskPanel {task} {busy} />
					</div>
				</div>
				<div class="flex min-h-0 flex-[0.6] flex-col border-t border-slate-800/80">
					<div class="panel-label">SYSTEM</div>
					<div class="min-h-0 flex-1">
						<SystemPanel {system} {connected} />
					</div>
				</div>
			</section>
		</div>

		<!-- Bottom: live log stream -->
		<section class="flex h-40 shrink-0 flex-col border-t border-slate-800/80">
			<div class="panel-label">EVENT STREAM</div>
			<div class="min-h-0 flex-1">
				<LogPanel {logs} />
			</div>
		</section>
	</main>
</div>

<style>
	.panel-label {
		padding: 0.75rem 1rem 0.25rem;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.25em;
		color: rgb(100 116 139);
	}
</style>
