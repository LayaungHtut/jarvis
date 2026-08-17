/**
 * BrowserController wraps Playwright when it is importable. Because Playwright
 * requires its own browser binaries which may not be installed, reads degrade
 * gracefully with a clear diagnostic rather than failing the whole agent.
 */
export class BrowserController {
	private browser: import('playwright').Browser | null = null;
	private page: import('playwright').Page | null = null;

	async readPage(url: string, timeoutMs = 8000): Promise<string> {
		const page = await this.open(url, timeoutMs);
		try {
			const text = await page.innerText('body');
			return text ?? '';
		} catch (err) {
			throw new Error(`Playwright navigation failed: ${(err as Error).message}`, { cause: err });
		}
	}

	/** Read the raw HTML of a URL (useful for scraping structured results). */
	async readHtml(url: string, timeoutMs = 8000): Promise<string> {
		const page = await this.open(url, timeoutMs);
		try {
			const html = await page.content();
			return html ?? '';
		} catch (err) {
			throw new Error(`Playwright navigation failed: ${(err as Error).message}`, { cause: err });
		}
	}

	private async open(url: string, timeoutMs: number): Promise<import('playwright').Page> {
		let playwright: typeof import('playwright');
		try {
			playwright = await import('playwright');
		} catch {
			throw new Error(
				'Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium'
			);
		}
		this.browser = await playwright.chromium.launch({ headless: true });
		this.page = await this.browser.newPage();
		this.page.setDefaultTimeout(timeoutMs);
		await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs * 1000 });
		return this.page;
	}

	async close(): Promise<void> {
		if (this.page) {
			await this.page.close().catch(() => undefined);
			this.page = null;
		}
		if (this.browser) {
			await this.browser.close().catch(() => undefined);
			this.browser = null;
		}
	}
}
