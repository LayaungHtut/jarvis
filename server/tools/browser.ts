import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { BrowserController } from '../browser/controller';

const exec = promisify(execFile);

/**
 * Browser automation via the user's default browser or a Playwright-controlled
 * Chromium instance. For Stage 1 we open URLs in the default browser and
 * delegate deeper agentic browsing to a BrowserController where Playwright is
 * available.
 */
export class OpenUrlTool extends Tool {
	name = 'open_url';
	description = 'Open a URL in the default web browser.';
	permissionLevel = 'low' as const;
	parameters = [{ name: 'url', type: 'string', description: 'Fully-qualified URL.' }] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const url = requireString(args, 'url', 2048);
		if (!/^https?:\/\//i.test(url)) return fail('Only http(s) URLs are supported.');
		try {
			if (process.platform === 'win32') {
				await exec('cmd', ['/c', 'start', '', url], { windowsHide: true });
			} else {
				await exec('xdg-open', [url], { windowsHide: true });
			}
			context.emit('TOOL_COMPLETED', { tool: this.name, url });
			return ok(`Opened ${url}`);
		} catch (err) {
			return fail(`Failed to open ${url}`, (err as Error).message);
		}
	}
}

export class SearchWebTool extends Tool {
	name = 'search_web';
	description = 'Search the web using the default browser (DuckDuckGo).';
	permissionLevel = 'low' as const;
	parameters = [{ name: 'query', type: 'string', description: 'Search query.' }] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		const query = requireString(args, 'query', 1000);
		const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
		try {
			if (process.platform === 'win32') {
				await exec('cmd', ['/c', 'start', '', url], { windowsHide: true });
			} else {
				await exec('xdg-open', [url], { windowsHide: true });
			}
			context.emit('TOOL_COMPLETED', { tool: this.name, query });
			return ok(`Searched: ${query}`);
		} catch (err) {
			return fail('Search failed.', (err as Error).message);
		}
	}
}

/**
 * Reads the current page in a Playwright-controlled browser. Returns the page
 * text (up to a cap) so the model can reason about the page content.
 */
export class ReadPageTool extends Tool {
	name = 'read_page';
	description = 'Open a URL in a headless browser context and return its visible text.';
	permissionLevel = 'medium' as const;
	parameters = [{ name: 'url', type: 'string', description: 'URL to read.' }] as const;

	async execute(args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> {
		const url = requireString(args, 'url', 2048);
		try {
			const browser = new BrowserController();
			const text = await browser.readPage(url, 8000);
			await browser.close();
			return ok(text ? 'Read page content.' : 'Page returned no readable text.', {
				url,
				text: text.slice(0, 12000)
			});
		} catch (err) {
			return fail('Failed to read page.', (err as Error).message);
		}
	}
}
