import WebSocket from 'ws';

const cmds = process.argv.slice(2).length ? process.argv.slice(2) : ['list my apps'];
const ws = new WebSocket('ws://127.0.0.1:8765/ws');
let idx = 0;
const t0 = Date.now();

ws.on('open', () => sendNext());
ws.on('message', (data) => {
	const msg = JSON.parse(String(data));
	const ms = Date.now() - t0;
	if (msg.type === 'snapshot') {
		console.log(`[${ms}ms] snapshot idle=${msg.payload?.status}`);
		return;
	}
	if (msg.event === 'STATUS_CHANGED') {
		console.log(`[${ms}ms] STATUS_CHANGED -> ${msg.payload.status}`);
		if (msg.payload.status === 'idle') {
			if (idx >= cmds.length) process.exit(0);
			setTimeout(sendNext, 500);
		}
	}
	if (msg.event === 'PLAN_CREATED') {
		console.log(
			`[${ms}ms] PLAN: ${JSON.stringify(msg.payload.plan.map((p) => `${p.tool}(${JSON.stringify(p.args)})`))}`
		);
	}
	if (msg.event === 'CHAIN_ACTIVITY') {
		console.log(
			`[${ms}ms] CHAIN ${msg.payload.role} r${msg.payload.round}: ${msg.payload.issues?.join(' | ')}`
		);
	}
	if (msg.event === 'TASK_COMPLETED') {
		console.log(`[${ms}ms] COMPLETED: ${JSON.stringify(msg.payload.result).slice(0, 200)}`);
	}
	if (msg.event === 'TASK_FAILED') {
		console.log(`[${ms}ms] FAILED: ${msg.payload.error}`);
	}
	if (msg.event === 'CONVERSATION_UPDATED') {
		const c = msg.payload.conversation;
		const last = c[c.length - 1];
		if (last && last.role === 'assistant')
			console.log(`[${ms}ms] REPLY: ${String(last.content).slice(0, 160)}`);
	}
});

function sendNext() {
	if (idx >= cmds.length) return;
	const cmd = cmds[idx++];
	console.log(`\n[${Date.now() - t0}ms] >>> ${cmd}`);
	ws.send(JSON.stringify({ type: 'command', text: cmd }));
}

setTimeout(() => {
	console.log('GLOBAL TIMEOUT');
	process.exit(0);
}, 180000);
