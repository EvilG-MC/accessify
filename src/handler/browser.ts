import playwright from "playwright";
import type { Browser, LaunchOptions, BrowserContext, Page } from "playwright";
import type {
	SpotifyToken,
	SpotifyClientToken,
	ClientTokenResponse,
} from "../types/spotify";
import { logs } from "../utils/logger";
import { Semaphore } from "../utils/semaphore";

const BLOCKED_TYPES = new Set([
	"image",
	"stylesheet",
	"font",
	"media",
	"websocket",
	"other",
]);

const BLOCKED_PATTERNS = [
	"google-analytics",
	"doubleclick.net",
	"googletagmanager.com",
	"https://open.spotifycdn.com/cdn/images/",
	"https://encore.scdn.co/fonts/",
];

const isBlockedUrl = (url: string) =>
	BLOCKED_PATTERNS.some((pat) => url.includes(pat));

export class SpotifyBrowser {
	private browser: Browser | undefined;
	private context: BrowserContext | undefined;
	private persistentPage: Page | undefined;
	private browserSemaphore = new Semaphore();

	private async ensureBrowser(): Promise<{
		browser: Browser;
		context: BrowserContext;
	}> {
		if (!this.browser || !this.context) {
			try {
				const executablePath = process.env.BROWSER_PATH?.trim() || undefined;

				const launchOptions: LaunchOptions = {
					headless: true,
					args: [
						"--disable-gpu",
						"--disable-dev-shm-usage",
						"--disable-setuid-sandbox",
						"--no-sandbox",
						"--no-zygote",
						"--disable-extensions",
						"--disable-background-timer-throttling",
						"--disable-blink-features=AutomationControlled",
						"--disable-backgrounding-occluded-windows",
						"--disable-renderer-backgrounding",
						"--window-size=1920,1080",
					],
				};

				if (executablePath) launchOptions.executablePath = executablePath;

				this.browser = await playwright.chromium.launch(launchOptions);
				this.context = await this.browser.newContext({
					userAgent:
						"Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
				});

				this.persistentPage = await this.context.newPage();
				logs("info", "Browser and context created");
			} catch (err) {
				this.browser = undefined;
				this.context = undefined;
				logs("error", "Failed to launch browser or context", err);
				throw err;
			}
		} else {
			if (!this.browser.isConnected()) {
				logs("warn", "Browser disconnected, relaunching...");
				this.browser = undefined;
				this.context = undefined;
				return this.ensureBrowser();
			}
			try {
				this.context.pages();
			} catch {
				logs("warn", "Context closed, relaunching...");
				this.browser = undefined;
				this.context = undefined;
				return this.ensureBrowser();
			}
		}
		return { browser: this.browser, context: this.context };
	}

	private async getPage(context: BrowserContext): Promise<{
		page: Page;
		shouldClosePage: boolean;
	}> {
		if (this.persistentPage && !this.persistentPage.isClosed()) {
			await this.persistentPage.unrouteAll({ behavior: "ignoreErrors" });
			return { page: this.persistentPage, shouldClosePage: false };
		}
		const page = await context.newPage();
		return { page, shouldClosePage: true };
	}

	private async setupBlockingRoutes(page: Page): Promise<void> {
		await page.route("**/*", (route) => {
			const url = route.request().url();
			const type = route.request().resourceType();
			if (BLOCKED_TYPES.has(type) || isBlockedUrl(url)) {
				route.abort();
				return;
			}
			route.continue();
		});
	}

	public async fetchToken(
		cookies?: Array<{ name: string; value: string }>,
	): Promise<SpotifyToken> {
		const release = await this.browserSemaphore.acquire();
		try {
			const { context } = await this.ensureBrowser();
			const { page, shouldClosePage } = await this.getPage(context);

			try {
				await context.clearCookies();

				if (cookies && cookies.length > 0) {
					const cookieObjects = cookies.map((cookie) => ({
						name: cookie.name,
						value: cookie.value,
						domain: ".spotify.com",
						path: "/",
						httpOnly: false,
						secure: true,
						sameSite: "Lax" as const,
					}));
					await context.addCookies(cookieObjects);
					logs(
						"info",
						"Cookies set for request",
						cookieObjects.map((c) => ({
							name: c.name,
							value: `${c.value.slice(0, 20)}...`,
						})),
					);
				}

				await this.setupBlockingRoutes(page);

				const [response] = await Promise.all([
					page.waitForResponse(
						(res) => res.url().includes("/api/token") && res.status() === 200,
						{ timeout: 15000 },
					),
					page.goto("https://open.spotify.com/", {
						waitUntil: "commit",
						timeout: 15000,
					}),
				]);

				if (!response.ok()) {
					throw new Error(
						`Invalid response from Spotify: ${response.status()}`,
					);
				}

				let json: Record<string, unknown>;
				try {
					json = await response.json();
				} catch {
					throw new Error("Failed to parse response JSON");
				}

				delete json._notes;
				return json as SpotifyToken;
			} finally {
				if (shouldClosePage) {
					await page.close();
				} else {
					await page.unrouteAll({ behavior: "ignoreErrors" });
				}
			}
		} finally {
			release();
		}
	}

	public async fetchClientToken(): Promise<SpotifyClientToken> {
		const release = await this.browserSemaphore.acquire();
		try {
			const { context } = await this.ensureBrowser();
			const { page, shouldClosePage } = await this.getPage(context);

			try {
				await context.clearCookies();
				await this.setupBlockingRoutes(page);

				const [response] = await Promise.all([
					page.waitForResponse(
						(res) =>
							res.url().includes("clienttoken.spotify.com/v1/clienttoken") &&
							res.status() === 200,
						{ timeout: 15000 },
					),
					page.goto("https://open.spotify.com/", {
						waitUntil: "commit",
						timeout: 15000,
					}),
				]);

				if (!response.ok()) {
					throw new Error(
						`Invalid response from clienttoken endpoint: ${response.status()}`,
					);
				}

				let json: Record<string, unknown>;
				try {
					json = await response.json();
				} catch {
					throw new Error("Failed to parse response JSON");
				}

				if (!json || typeof json !== "object" || !("granted_token" in json)) {
					throw new Error(
						"Unexpected client token response: missing granted_token",
					);
				}

				const raw = json as ClientTokenResponse;
				const granted = raw.granted_token;
				const now = Date.now();
				const expiresAfter = Number(granted.expires_after_seconds ?? 0);
				const refreshAfter = Number(granted.refresh_after_seconds ?? 0);

				return {
					raw,
					accessToken: granted.token,
					accessTokenExpirationTimestampMs: now + expiresAfter * 1000,
					refreshAfterTimestampMs:
						refreshAfter > 0 ? now + refreshAfter * 1000 : undefined,
				};
			} finally {
				if (shouldClosePage) {
					await page.close();
				} else {
					await page.unrouteAll({ behavior: "ignoreErrors" });
				}
			}
		} finally {
			release();
		}
	}

	public async close(): Promise<void> {
		if (this.persistentPage && !this.persistentPage.isClosed()) {
			await this.persistentPage.close();
			this.persistentPage = undefined;
		}
		if (this.browser) {
			await this.browser.close();
			this.browser = undefined;
			this.context = undefined;
		}
	}
}
