import playwright, { type Browser, type Page, type Request } from "playwright";
import { logs, contextLogWithUndefined } from "../utils/logger";
import type { SpotifyToken } from "../types/spotify";

export class SpotifyBrowser {
	private browser: Browser | undefined;

	async ensureBrowser(): Promise<Browser> {
		if (this.browser?.isConnected?.()) {
			return this.browser;
		}
		const executablePath =
			process.env.BROWSER_PATH && process.env.BROWSER_PATH.trim() !== ""
				? process.env.BROWSER_PATH
				: undefined;
		this.browser = await playwright.chromium
			.launch({
				headless: true,
				args: [
					"--disable-gpu",
					"--disable-dev-shm-usage",
					"--disable-setuid-sandbox",
					"--no-sandbox",
					"--no-zygote",
					"--single-process",
					"--disable-background-timer-throttling",
					"--disable-backgrounding-occluded-windows",
					"--disable-renderer-backgrounding",
				],
				executablePath,
			})
			.catch(contextLogWithUndefined.bind(null, "Failed to spawn browser"));
		if (!this.browser) throw new Error("Failed to launch browser");
		return this.browser;
	}

	async fetchToken(): Promise<SpotifyToken> {
		return new Promise<SpotifyToken>((resolve, reject) => {
			const run = async () => {
				let browser: Browser;
				try {
					browser = await this.ensureBrowser();
				} catch {
					return reject(new Error("Failed to launch browser"));
				}
				const page: Page | undefined = await browser
					.newPage()
					.catch(contextLogWithUndefined.bind(null, "Failed to open new page"));
				if (!page) {
					await browser.close();
					this.browser = undefined;
					return reject(new Error("Failed to open new page"));
				}

				await page.route("**/*", (route) => {
					const url = route.request().url();
					const type = route.request().resourceType();
					if (
						type === "image" ||
						type === "stylesheet" ||
						type === "font" ||
						type === "media" ||
						type === "websocket" ||
						type === "other"
					) {
						route.abort();
						return;
					}
					if (
						url.includes("google-analytics") ||
						url.includes("doubleclick.net") ||
						url.includes("googletagmanager.com") ||
						url.startsWith("https://open.spotifycdn.com/cdn/images/") ||
						url.startsWith("https://encore.scdn.co/fonts/")
					) {
						route.abort();
						return;
					}
					route.continue();
				});

				let processedAccessTokenRequest = false;
				const timeout = setTimeout(() => {
					if (!processedAccessTokenRequest) {
						logs(
							"warn",
							"Deadline exceeded without processing access token request, did the endpoint change?",
						);
					}
					page.close();
					reject(new Error("Token fetch exceeded deadline"));
				}, 15000);

				page.on("requestfinished", async (event: Request) => {
					if (!event.url().includes("/api/token")) return;
					processedAccessTokenRequest = true;
					let response: unknown;
					try {
						response = await event.response();
					} catch {
						response = null;
					}
					if (!response || !(response as Response).ok) {
						page.removeAllListeners();
						await page.close();
						clearTimeout(timeout);
						return reject(new Error("Invalid response from Spotify."));
					}
					let json: unknown;
					try {
						json = await (response as Response).json();
					} catch {
						json = null;
					}
					if (
						json &&
						typeof json === "object" &&
						json !== null &&
						"_notes" in json
					) {
						delete (json as Record<string, unknown>)._notes;
					}
					page.removeAllListeners();
					await page.close();
					clearTimeout(timeout);
					resolve(json as SpotifyToken);
				});

				page.goto("https://open.spotify.com/").catch((err: unknown) => {
					if (!processedAccessTokenRequest) {
						page.close();
						clearTimeout(timeout);
						reject(new Error(`Failed to goto URL: ${err}`));
					}
				});
			};
			run();
		});
	}
}
