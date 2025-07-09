import playwright, {
	type Browser,
	type Page,
	type Request,
} from "playwright";
import { Semaphore } from "../utils/semaphore";
import { logs, contextLogWithUndefined } from "../utils/logger";
import type { SpotifyToken, TokenProxy } from "../types/spotify";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export class SpotifyTokenHandler {
	public semaphore = new Semaphore();
	public cachedAccessToken: SpotifyToken | undefined = undefined;
	private refreshTimeout: NodeJS.Timeout | undefined;
	private _initialFetchStart: number;
	private browser: Browser | undefined;

	constructor() {
		this._initialFetchStart = Date.now();
		// fetch initial token on startup
		this.getAccessToken()
			.then((token) => {
				this.cachedAccessToken = token;
				const elapsed = Date.now() - this._initialFetchStart;
				logs("info", `Initial Spotify token fetched in ${elapsed}ms`);
			})
			.catch((err) => {
				logs("warn", "Failed to fetch initial Spotify token", err);
			});
	}

	private scheduleNextRefresh() {
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		const token = this.cachedAccessToken;
		if (!token) return;
		const now = Date.now();
		const expiresIn = token.accessTokenExpirationTimestampMs - now;
		const refreshIn = Math.max(expiresIn + 100, 0); // refresh this trash thing 100ms after expired
		this.refreshTimeout = setTimeout(async () => {
			try {
				const release = await this.semaphore.acquire();
				try {
					const newToken = await this.getAccessToken();
					this.cachedAccessToken = newToken;
					logs("info", "Spotify token auto-refreshed (timeout)");
				} finally {
					release();
				}
			} catch (err) {
				logs("warn", "Failed to auto-refresh Spotify token", err);
			}
			this.scheduleNextRefresh();
		}, refreshIn);
	}

	private async ensureBrowser(): Promise<Browser> {
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

	public getAccessToken = async (): Promise<SpotifyToken> => {
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

				// Block unnecessary resources and specific URLs
				await page.route("**/*", (route) => {
					const url = route.request().url();
					const type = route.request().resourceType();
					// Block by resource type
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
					this.cachedAccessToken = json as SpotifyToken;
					this.scheduleNextRefresh();
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
	};

	public honoHandler = async (c: Context): Promise<Response> => {
		const isForce = ["1", "yes", "true"].includes(
			(c.req.query("force") || "").toLowerCase(),
		);
		const connInfo = getConnInfo(c);
		const ip = connInfo?.remote?.address || "unknown";
		const userAgent = c.req.header("user-agent") ?? "no ua";
		const start = Date.now();
		const result = await this.handleTokenRequest(c, isForce);
		const elapsed = Date.now() - start;
		logs(
			"info",
			`Handled Spotify Token request from IP: ${ip}, UA: ${userAgent} (force: ${isForce}) in ${elapsed}ms`,
		);
		return result;
	};

	private handleTokenRequest = async (
		c: Context,
		isForce: boolean,
	): Promise<Response> => {
		const thisHandler = this;
		const token: TokenProxy = {
			type: "cachedAccessToken",
			fetch: this.getAccessToken,
			get data() {
				return thisHandler.cachedAccessToken;
			},
			valid() {
				return (
					(this.data?.accessTokenExpirationTimestampMs || 0) - 10000 >
					Date.now()
				);
			},
			async refresh() {
				const data = await this.fetch();
				thisHandler.cachedAccessToken = data;
				return data;
			},
		};

		if (!isForce && token.valid()) {
			return c.json(token.data, 200);
		}

		const release = await this.semaphore.acquire();
		try {
			if (!isForce && token.valid()) {
				return c.json(token.data, 200);
			} else {
				const refreshed = await token.refresh();
				return c.json(refreshed, 200);
			}
		} catch (e) {
			logs("error", e);
			return c.json({}, 500);
		} finally {
			release();
		}
	};
}
