import puppeteer, { type Browser, type Page, type HTTPResponse } from "puppeteer-core";
import { Semaphore } from "../utils/semaphore";
import { logWithTimestamp, contextLogWithUndefined } from "../utils/logger";
import type { SpotifyToken, TokenProxy } from "../types/spotify";
import type { Context } from "hono";

export class SpotifyTokenHandler {
	public semaphore = new Semaphore();
	public cachedAccessToken: SpotifyToken | undefined = undefined;

	getAccessToken = async (): Promise<SpotifyToken> => {
		return new Promise<SpotifyToken>((resolve, reject) => {
			(async () => {
				const browser: Browser | undefined = await puppeteer
					.launch({ 
						headless: true,
						executablePath: "/home/container/chrome-linux/chrome",
						args: ['--no-sandbox', '--disable-setuid-sandbox']
					})
					.catch(contextLogWithUndefined.bind(null, "Failed to spawn browser"));
				if (!browser) return reject(new Error("Failed to launch browser"));

				const page: Page | undefined = await browser
					.newPage()
					.catch(contextLogWithUndefined.bind(null, "Failed to open new page"));
				if (!page) {
					await browser.close();
					return reject(new Error("Failed to open new page"));
				}

				let processedAccessTokenRequest = false;
				const timeout = setTimeout(() => {
					if (!processedAccessTokenRequest) {
						logWithTimestamp(
							"warn",
							"Deadline exceeded without processing access token request, did the endpoint change?",
						);
					}
					browser.close();
					reject(new Error("Token fetch exceeded deadline"));
				}, 15000);

				page.on("response", async (response: HTTPResponse) => {
					if (!response.url().includes("/api/token")) return;
					processedAccessTokenRequest = true;
					
					if (!response.ok()) {
						await browser.close();
						clearTimeout(timeout);
						return reject(new Error("Invalid response from Spotify."));
					}
					
					let json: unknown;
					try {
						json = await response.json();
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
					
					await browser.close();
					clearTimeout(timeout);
					resolve(json as SpotifyToken);
				});

				page.goto("https://open.spotify.com/").catch((err: unknown) => {
					if (!processedAccessTokenRequest) {
						browser.close();
						clearTimeout(timeout);
						reject(new Error(`Failed to goto URL: ${err}`));
					}
				});
			})();
		});
	};

	honoHandler = async (c: Context): Promise<Response> => {
		const isForce = ["1", "yes", "true"].includes(
			(c.req.query("force") || "").toLowerCase(),
		);
		// Ambil IP address dari header atau raw request (tanpa any)
		let ip = c.req.header("x-forwarded-for");
		if (!ip) {
			const raw = c.req.raw;
			// Node.js IncomingMessage has socket.remoteAddress
			if (typeof raw === "object" && raw && "socket" in raw) {
				const socket = (raw as { socket?: { remoteAddress?: string } }).socket;
				if (socket && typeof socket.remoteAddress === "string") {
					ip = socket.remoteAddress;
				}
			}
		}
		ip = ip || "unknown";
		const userAgent = c.req.header("user-agent") ?? "no ua";
		const start = Date.now();
		const result = await this.handleTokenRequest(c, isForce);
		const elapsed = Date.now() - start;
		logWithTimestamp(
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
			refresh() {
				return this.fetch().then((data) => {
					thisHandler.cachedAccessToken = data;
					return data;
				});
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
			logWithTimestamp("error", e);
			return c.json({}, 500);
		} finally {
			release();
		}
	};
}
