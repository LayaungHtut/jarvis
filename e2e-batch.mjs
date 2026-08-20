import WebSocket from 'ws';

const commands = [
	'list open windows',
	'what is my computer name',
	'play next track',
	'copy hello to the clipboard',
	'list my apps',
	'search files for report',
	'show me the buttons in this window',
	'close notepad',
	'lock the computer'
];

const results = [];
const ws = new WebSocket('ws://127.0.0.1:8765/ws');
let current = null;
let idle = false;
let started = null;

function sendNext() {
	if (!commands.length) return finish();
	current = commands.shift();
	started = Date.now();
	console.log('\n>>> ' + current);
	idle = false;
	ws.send(JSON.stringify({ type: 'command', text: current }));
	setTimeout(() => {
		if (idle) return;
		results.push({ cmd: current, reply: 'TIMEOUT' });
		current = null;
		sendNext();
	}, 45000);
}

ws.on('message', (data) => {
	const msg = JSON.parse(String(data));
	if (msg.type === 'snapshot') {
		idle = true;
		sendNext();
		return;
	}
	if (msg.event === 'STATUS_CHANGED' && msg.payload.status === 'idle' && current && !idle) {
		idle = true;
		const ms = Date.now() - started;
		console.log(`   (idle after ${ms}ms)`);
		results.push({ cmd: current, reply: '(completed)', ms });
		current = null;
		setTimeout(sendNext, 800);
	}
	if (msg.event === 'TASK_FAILED') {
		results.push({ cmd: current, reply: 'TASK_FAILED' });
		current = null;
		sendNext();
	}
	if (msg.event === 'CONVERSATION_UPDATED' && current) {
		const c = msg.payload.conversation;
		const last = c[c.length - 1];
		if (last && last.role === 'assistant') {
			const rec = results.find((r) => r.cmd === current);
			if (rec && !rec.replyLine) rec.replyLine = last.content.slice(0, 120);
			else if (!rec) results.push({ cmd: current, replyLine: last.content.slice(0, 120) });
		}
	}
});

function finish() {
	console.log('\n==== RESULTS ====');
	for (const r of results)
		console.log(`${r.cmd}${r.ms ? ` [${r.ms}ms]` : ''}\n    -> ${r.replyLine ?? r.reply ?? ''}`);
	ws.close();
	process.exit(0);
}

ws.on('error', (e) => {
	console.error('WS ERROR: ' + e.message);
	process.exit(1);
});

setTimeout(() => {
	console.log('GLOBAL TIMEOUT');
	finish();
}, 400000);
