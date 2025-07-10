import { SpotifyBrowser } from "./browser";
import { Semaphore } from "../utils/semaphore";
import { logs } from "../utils/logger";
import type { SpotifyToken } from "../types/spotify";
import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { handleRequest } from "./request";

export class SpotifyTokenHandler {
	private semaphore = new Semaphore();
	private accessToken: SpotifyToken | undefined;
	private refreshTimeout: NodeJS.Timeout | undefined;
	private browser = new SpotifyBrowser();

	constructor() {
		const initFetch = Date.now();
		// fetch initial token on startup
		this.getAccessToken()
			.then((token) => {
				this.accessToken = token;
				const elapsed = Date.now() - initFetch;
				logs("info", `Initial Spotify token fetched in ${elapsed}ms`);
			})
			.catch((err) => {
				logs("warn", "Failed to fetch initial Spotify token", err);
			});
	}

	private setRefresh() {
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		const token = this.accessToken;
		if (!token) return;
		const now = Date.now();
		const expiresIn = token.accessTokenExpirationTimestampMs - now;
		const refreshIn = Math.max(expiresIn + 100, 0); // refresh this trash thing 100ms after expired
		this.refreshTimeout = setTimeout(async () => {
			try {
				const release = await this.semaphore.acquire();
				try {
					const newToken = await this.getAccessToken();
					this.accessToken = newToken;
					logs("info", "Spotify token auto-refreshed (timeout)");
				} finally {
					release();
				}
			} catch (err) {
				logs("warn", "Failed to auto-refresh Spotify token", err);
			}
			this.setRefresh();
		}, refreshIn);
	}

	private getAccessToken = async (): Promise<SpotifyToken> => {
		return new Promise<SpotifyToken>((resolve, reject) => {
			const run = async () => {
				try {
					const token = await this.browser.fetchToken();
					this.accessToken = token;
					this.setRefresh();
					resolve(token);
				} catch (err) {
					reject(err);
				}
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
		const result = await handleRequest(
			c,
			isForce,
			this.getAccessToken,
			() => this.accessToken,
			(token) => {
				this.accessToken = token;
			},
			this.semaphore,
		);
		const elapsed = Date.now() - start;
		logs(
			"info",
			`Handled Spotify Token request from IP: ${ip}, UA: ${userAgent} (force: ${isForce}) in ${elapsed}ms`,
		);
		return result;
	};
}
