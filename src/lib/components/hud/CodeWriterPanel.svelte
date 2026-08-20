<script lang="ts">
	import type { LogEntry, WrittenFile } from '$lib/shared/types';

	let { files, logs, connected }: { files: WrittenFile[]; logs: LogEntry[]; connected: boolean } =
		$props();

	let activePath = $state<string | null>(null);
	let shown = $state<Record<string, number>>({});
	let typing = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastHandled: string | null = null;

	const fileMap = $derived(new Map(files.map((f) => [f.path, f])));
	const tabs = $derived([...fileMap.keys()]);
	const active = $derived(activePath ? (fileMap.get(activePath) ?? null) : null);
	const activeShown = $derived(active ? (shown[active.path] ?? 0) : 0);
	const rendered = $derived(
		active ? highlight(active.content.slice(0, activeShown), active.path) : ''
	);
	const currentLogs = $derived(logs.slice(-60));

	$effect(() => {
		const last = files.length ? files[files.length - 1] : null;
		if (!last) return;
		const key = `${last.path}:${last.timestamp}`;
		if (lastHandled === key) return;
		lastHandled = key;
		activePath = last.path;
		shown = { ...shown, [last.path]: 0 };
		pump(last.path);
	});

	function pump(path: string) {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		const f = fileMap.get(path);
		if (!f) return;
		const n = f.content.length;
		if (n === 0) {
			shown = { ...shown, [path]: 0 };
			return;
		}
		const instant = n > 30_000;
		const step = () => {
			const cur = shown[path] ?? 0;
			if (cur >= n) {
				typing = false;
				return;
			}
			const chunk = instant ? n - cur : Math.floor(Math.random() * 6) + 3;
			shown = { ...shown, [path]: Math.min(cur + chunk, n) };
			typing = true;
			if ((shown[path] ?? 0) < n) {
				timer = setTimeout(step, instant ? 0 : 12 + Math.random() * 26);
			} else {
				typing = false;
			}
		};
		step();
	}

	function selectTab(path: string) {
		activePath = path;
		if (shown[path] === undefined) {
			const f = fileMap.get(path);
			shown = { ...shown, [path]: f ? f.content.length : 0 };
		} else {
			pump(path);
		}
	}

	function basename(path: string): string {
		return path.split(/[\\/]/).pop() ?? path;
	}

	function time(ts: string): string {
		const d = new Date(ts);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleTimeString([], {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function autoScrollBottom(node: HTMLElement) {
		const scroll = () => {
			node.scrollTop = node.scrollHeight;
		};
		const obs = new MutationObserver(scroll);
		obs.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
		scroll();
		return () => obs.disconnect();
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	type Lang = 'js' | 'html' | 'css' | 'py' | 'txt';

	function langOf(path: string): Lang {
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'svelte'].includes(ext)) return 'js';
		if (['html', 'htm', 'xml', 'vue'].includes(ext)) return 'html';
		if (['css', 'scss', 'less'].includes(ext)) return 'css';
		if (ext === 'py') return 'py';
		return 'txt';
	}

	const JS_RE =
		/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|for|while|of|in|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|switch|case|break|continue|typeof|instanceof|this|true|false|null|undefined)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()|\b(\d[\d_.]*\b)|([{}()[\];:,=+\-*/%<>!&|?.~^]+)/g;
	const HTML_RE = /(<!--[\s\S]*?-->)|(<\/?[A-Za-z][^>]*>)|("[^"]*"|'[^']*')/g;
	const CSS_RE =
		/(\/\*[\s\S]*?\*\/)|([.#]?[\w-]+(?=\s*\{))|([\w-]+(?=\s*:))|(@[\w-]+)|("[^"]*"|'[^']*')|(\d[\w.%]*)/g;
	const PY_RE =
		/(#[^\n]*)|('''[\s\S]*?'''|"""[\s\S]*?"""|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|try|except|finally|with|as|lambda|yield|pass|break|continue|global|nonlocal|assert|raise|True|False|None|async|await)\b|(@[\w.]+)|(\b\d[\d_.]*\b)/g;

	const RULES: Record<Exclude<Lang, 'txt'>, { re: RegExp; cls: string[] }> = {
		js: { re: JS_RE, cls: ['c-com', 'c-str', 'c-kw', 'c-fn', 'c-num', 'c-p'] },
		html: { re: HTML_RE, cls: ['c-com', 'c-tag', 'c-str'] },
		css: { re: CSS_RE, cls: ['c-com', 'c-sel', 'c-prop', 'c-at', 'c-str', 'c-num'] },
		py: { re: PY_RE, cls: ['c-com', 'c-str', 'c-kw', 'c-deco', 'c-num'] }
	};

	// All text is escaped via escapeHtml before being injected; {@html} is only
	// used to render the highlighted <span> wrappers we control ourselves.
	function highlight(src: string, path: string): string {
		const lang = langOf(path);
		if (lang === 'txt') return escapeHtml(src);
		const { re, cls } = RULES[lang];
		let out = '';
		let last = 0;
		let m: RegExpExecArray | null;
		re.lastIndex = 0;
		while ((m = re.exec(src))) {
			out += escapeHtml(src.slice(last, m.index));
			const gi = m.slice(1).findIndex(Boolean);
			out += gi >= 0 ? `<span class="${cls[gi]}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
			last = m.index + m[0].length;
		}
		return out + escapeHtml(src.slice(last));
	}
</script>

<div class="cw">
	<div class="cw-head">
		<span class="dots"><i></i><i></i><i></i></span>
		<span class="cw-title">jarvis — agentic coding session</span>
		<span class="cw-status" class:off={!connected}>
			<span class="pulse"></span>{connected ? 'CHANNEL LIVE' : 'OFFLINE'}
		</span>
	</div>

	<div class="cw-body">
		<div class="cw-log" {@attach autoScrollBottom}>
			{#if currentLogs.length === 0}
				<p class="cw-empty">Awaiting system events…</p>
			{:else}
				{#each currentLogs as entry (entry.id)}
					<div class="ln {entry.level}">
						<span class="t">{time(entry.timestamp)}</span>
						<span class="lv">{entry.level[0]?.toUpperCase()}</span>
						{#if entry.tool}<span class="tool">[{entry.tool}]</span>{/if}
						<span class="msg">{entry.message}</span>
					</div>
				{/each}
			{/if}
		</div>

		<div class="cw-code">
			<div class="tabs">
				{#each tabs as path (path)}
					<button
						class="tab"
						class:active={activePath === path}
						onclick={() => selectTab(path)}
						title={path}
					>
						{basename(path)}
						{#if activePath === path && typing}<span class="typing-dot"></span>{/if}
					</button>
				{/each}
				{#if tabs.length === 0}
					<span class="tab placeholder">no files yet</span>
				{/if}
			</div>
			<div class="code-view" {@attach autoScrollBottom}>
				{#if active}
					<span class="code-path">{active.path}</span>
					<div class="code-body">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- every char is HTML-escaped in `highlight()` before injection -->
						<pre class="code-pre"><code>{@html rendered}</code></pre>
						{#if typing}<span class="caret"></span>{/if}
					</div>
				{:else}
					<p class="cw-empty">
						No files written yet. Give JARVIS a command — every write_file lands here live.
					</p>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.cw {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: #0b1020;
		border: 1px solid rgb(51 65 85 / 0.8);
		border-radius: 12px;
		overflow: hidden;
		font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
	}
	.cw-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.7rem 1rem;
		background: #111731;
		border-bottom: 1px solid rgb(51 65 85 / 0.6);
	}
	.dots {
		display: flex;
		gap: 6px;
	}
	.dots i {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #f87171;
	}
	.dots i:nth-child(2) {
		background: #fbbf24;
	}
	.dots i:nth-child(3) {
		background: #34d399;
	}
	.cw-title {
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #94a3b8;
		letter-spacing: 0.05em;
	}
	.cw-status {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.15em;
		color: #34d399;
	}
	.cw-status .pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #34d399;
		box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6);
		animation: cw-pulse 2s infinite;
	}
	.cw-status.off {
		color: #f87171;
	}
	.cw-status.off .pulse {
		background: #f87171;
		box-shadow: none;
		animation: none;
	}
	@keyframes cw-pulse {
		70% {
			box-shadow: 0 0 0 8px rgba(52, 211, 153, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
		}
	}

	.cw-body {
		display: grid;
		grid-template-columns: 280px 1fr;
		flex: 1;
		min-height: 0;
	}
	.cw-log {
		border-right: 1px solid rgb(51 65 85 / 0.6);
		overflow-y: auto;
		padding: 0.6rem 0.75rem;
		font-size: 11px;
		line-height: 1.7;
		background: #0b1020;
	}
	.cw-log .ln {
		color: #64748b;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.cw-log .ln .t {
		color: #475569;
		margin-right: 0.4rem;
	}
	.cw-log .ln .lv {
		margin-right: 0.4rem;
		font-weight: 700;
	}
	.cw-log .ln .tool {
		color: #22d3ee;
		margin-right: 0.4rem;
	}
	.cw-log .ln.info {
		color: #94a3b8;
	}
	.cw-log .ln.debug {
		color: #64748b;
	}
	.cw-log .ln.warn {
		color: #fbbf24;
	}
	.cw-log .ln.error {
		color: #f87171;
	}

	.cw-code {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: #0d1326;
	}
	.tabs {
		display: flex;
		gap: 2px;
		overflow-x: auto;
		padding: 0.5rem 0.75rem 0;
		border-bottom: 1px solid rgb(51 65 85 / 0.6);
		background: #0b1020;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0.35rem 0.85rem;
		border-radius: 8px 8px 0 0;
		border: 1px solid transparent;
		background: transparent;
		color: #64748b;
		font-family: inherit;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab:hover {
		color: #cbd5e1;
	}
	.tab.active {
		background: #0d1326;
		border-color: rgb(51 65 85 / 0.6);
		border-bottom-color: #0d1326;
		color: #e2e8f0;
	}
	.tab.placeholder {
		color: #475569;
		font-style: italic;
		cursor: default;
	}
	.typing-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #22d3ee;
		animation: cw-pulse 1.2s infinite;
	}
	.code-view {
		position: relative;
		flex: 1;
		overflow-y: auto;
		padding: 0.9rem 1.1rem 1.4rem;
	}
	.code-path {
		position: absolute;
		top: 0.4rem;
		right: 0.9rem;
		font-size: 10px;
		color: #475569;
	}
	.code-body {
		display: flex;
		align-items: flex-start;
	}
	.code-pre {
		margin: 0;
		font-family: inherit;
		font-size: 12.5px;
		line-height: 1.7;
		color: #cbd5e1;
		white-space: pre;
	}
	.code-pre code {
		font-family: inherit;
	}
	.caret {
		display: inline-block;
		width: 8px;
		height: 1.1em;
		margin-top: 0.2em;
		background: #22d3ee;
		box-shadow: 0 0 8px #22d3ee;
		animation: cw-blink 0.9s steps(1) infinite;
	}
	@keyframes cw-blink {
		50% {
			opacity: 0;
		}
	}
	.cw-empty {
		padding: 1.5rem;
		color: #475569;
		font-size: 12px;
		text-align: center;
	}

	.c-com {
		color: #64748b;
		font-style: italic;
	}
	.c-str {
		color: #34d399;
	}
	.c-kw {
		color: #c084fc;
	}
	.c-fn {
		color: #60a5fa;
	}
	.c-num {
		color: #fbbf24;
	}
	.c-p {
		color: #64748b;
	}
	.c-tag {
		color: #fbbf24;
	}
	.c-sel {
		color: #60a5fa;
	}
	.c-prop {
		color: #38bdf8;
	}
	.c-at {
		color: #f472b6;
	}
	.c-deco {
		color: #f472b6;
	}

	@media (max-width: 900px) {
		.cw-body {
			grid-template-columns: 1fr;
			grid-template-rows: 130px 1fr;
		}
		.cw-log {
			border-right: 0;
			border-bottom: 1px solid rgb(51 65 85 / 0.6);
		}
	}
</style>
