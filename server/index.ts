import http from 'node:http';
import { loadEnv } from './config/env';
import { JarvisServer } from './ws/server';

loadEnv();

const PORT = Number(process.env.JARVIS_PORT ?? 8765);
const HOST = process.env.JARVIS_HOST ?? '127.0.0.1';

const server = http.createServer((req, res) => {
	// Minimal REST surface used by the frontend: health + info endpoint.
	if (req.url === '/api/health') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({ ok: true, service: 'jarvis-backend', time: new Date().toISOString() })
		);
		return;
	}
	if (req.url?.startsWith('/api/info')) {
		const jarvis = (server as unknown as { jarvis?: JarvisServer }).jarvis;
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(jarvis?.info() ?? null));
		return;
	}
	res.writeHead(404, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ error: 'not_found' }));
});

const jarvis = new JarvisServer(server);
(server as unknown as { jarvis?: JarvisServer }).jarvis = jarvis;

server.listen(PORT, HOST, () => {
	console.log(`🔮 JARVIS backend listening on ws://${HOST}:${PORT}/ws`);
	console.log(`   REST  http://${HOST}:${PORT}/api/health`);
});

function shutdown(signal: string): void {
	console.log(`\nReceived ${signal}, shutting down…`);
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(1), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
