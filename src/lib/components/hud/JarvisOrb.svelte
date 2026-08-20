<script lang="ts">
	import { Canvas } from '@threlte/core';
	import OrbScene from './orb/OrbScene.svelte';
	import { ORB_THEMES } from './orb/themes';
	import type { AgentStatus } from '$lib/shared/types';

	let { status }: { status: AgentStatus } = $props();

	const theme = $derived(ORB_THEMES[status]);
</script>

<div class="flex flex-col items-center justify-center gap-4 select-none">
	<div class="h-64 w-64 sm:h-72 sm:w-72 lg:h-80 lg:w-80">
		<Canvas dpr={[1, 2]}>
			<OrbScene {status} />
		</Canvas>
	</div>
	<div class="text-center">
		<div
			class="text-2xl font-semibold tracking-[0.35em] transition-colors duration-300 {theme.text}"
		>
			{theme.label}
		</div>
	</div>
</div>
