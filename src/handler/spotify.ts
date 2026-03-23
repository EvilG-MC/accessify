import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { SpotifyClientToken, SpotifyToken } from "../types/spotify";
import { logs } from "../utils/logger";
import { Semaphore } from "../utils/semaphore";
import { SpotifyBrowser } from "./browser";
import { handleRequest } from "./request";

export class SpotifyTokenHandler {
	private accessSemaphore = new Semaphore();
	private clientSemaphore = new Semaphore();

	private accessToken: SpotifyToken | undefined;
	private clientToken: SpotifyClientToken | undefined;
	private refreshTimeout: NodeJS.Timeout | undefined;
	private clientRefreshTimeout: NodeJS.Timeout | undefined;
	private browser = new SpotifyBrowser();

	constructor() {
		const initFetch = Date.now();

		const tryInit = async (attempt = 1) => {
			try {
				const token = await this.getAccessToken();
				this.accessToken = token;
				const elapsed = Date.now() - initFetch;
				logs("info", `Initial Spotify token fetched in ${elapsed}ms`);
			} catch (err) {
				logs(
					"warn",
					`Failed to fetch initial Spotify token (attempt ${attempt})`,
					err,
				);
				if (attempt < 3) {
					setTimeout(() => tryInit(attempt + 1), 2000 * attempt);
				}
			}
		};

		const tryInitClient = async (attempt = 1) => {
			try {
				const token = await this.getClientToken();
				this.clientToken = token;
				const elapsed = Date.now() - initFetch;
				logs("info", `Initial Spotify client token fetched in ${elapsed}ms`);
			} catch (err) {
				logs(
					"warn",
					`Failed to fetch initial Spotify client token (attempt ${attempt})`,
					err,
				);
				if (attempt < 3) {
					setTimeout(() => tryInitClient(attempt + 1), 2000 * attempt);
				}
			}
		};

		tryInit().then(() => tryInitClient());
	}

	public async cleanup(): Promise<void> {
		if (this.refreshTimeout) {
			clearTimeout(this.refreshTimeout);
			this.refreshTimeout = undefined;
		}
		if (this.clientRefreshTimeout) {
			clearTimeout(this.clientRefreshTimeout);
			this.clientRefreshTimeout = undefined;
		}
		await this.browser.close();
	}

	private setRefresh() {
		if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
		const token = this.accessToken;
		if (!token) return;
		const now = Date.now();
		const expiresIn = token.accessTokenExpirationTimestampMs - now;
		let refreshIn = Math.max(expiresIn + 100, 0);

		if (Number.isNaN(refreshIn)) {
			logs("warn", "setRefresh: refreshIn is NaN, defaulting to 1 hour");
			refreshIn = 3600 * 1000;
		}

		this.refreshTimeout = setTimeout(async () => {
			try {
				const release = await this.accessSemaphore.acquire();
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

	private setClientRefresh() {
		if (this.clientRefreshTimeout) clearTimeout(this.clientRefreshTimeout);
		const token = this.clientToken;
		if (!token) return;
		const now = Date.now();
		let refreshIn: number;
		if (token.refreshAfterTimestampMs !== undefined) {
			refreshIn = Math.max(token.refreshAfterTimestampMs - now + 100, 0);
		} else {
			refreshIn = Math.max(
				token.accessTokenExpirationTimestampMs - now + 100,
				0,
			);
		}

		if (Number.isNaN(refreshIn)) {
			logs("warn", "setClientRefresh: refreshIn is NaN, defaulting to 1 hour");
			refreshIn = 3600 * 1000;
		}

		this.clientRefreshTimeout = setTimeout(async () => {
			try {
				const release = await this.clientSemaphore.acquire();
				try {
					const newToken = await this.getClientToken();
					this.clientToken = newToken;
					logs("info", "Spotify client token auto-refreshed (timeout)");
				} finally {
					release();
				}
			} catch (err) {
				logs("warn", "Failed to auto-refresh Spotify client token", err);
			}
			this.setClientRefresh();
		}, refreshIn);
	}

	private getAccessToken = async (
		cookies?: Array<{ name: string; value: string }>,
	): Promise<SpotifyToken> => {
		try {
			const token = await this.browser.fetchToken(cookies);
			this.accessToken = token;
			this.setRefresh();
			return token;
		} catch (err) {
			logs("error", "Error in getAccessToken", err);
			throw err;
		}
	};

	private getClientToken = async (): Promise<SpotifyClientToken> => {
		try {
			const token = await this.browser.fetchClientToken();
			this.clientToken = token;
			this.setClientRefresh();
			return token;
		} catch (err) {
			logs("error", "Error in getClientToken", err);
			throw err;
		}
	};

	private normalizeIp(raw: string | undefined): string {
		if (!raw) return "unknown";
		if (raw === "::1") return "127.0.0.1";
		if (raw.startsWith("::ffff:")) return raw.replace("::ffff:", "");
		return raw;
	}

	public honoHandler = async (c: Context): Promise<Response> => {
		const isForce = ["1", "yes", "true"].includes(
			(c.req.query("force") || "").toLowerCase(),
		);
		const connInfo = getConnInfo(c);
		let ip = connInfo?.remote?.address || "unknown";
		ip = this.normalizeIp(ip);
		const userAgent = c.req.header("user-agent") ?? "no ua";
		const start = Date.now();

		const cookies: Array<{ name: string; value: string }> = [];
		const cookieHeader = c.req.header("cookie");
		if (cookieHeader) {
			const cookiePairs = cookieHeader.split(";");
			for (const pair of cookiePairs) {
				const [name, ...rest] = pair.trim().split("=");
				if (name && rest.length > 0) {
					cookies.push({ name, value: rest.join("=") });
				}
			}
			logs(
				"info",
				`Request with cookies: ${cookies.map((c) => `${c.name}=${c.value.slice(0, 20)}...`).join(", ")}`,
			);
		} else {
			logs("info", "Request without cookies");
		}

		const result = await handleRequest(
			c,
			isForce,
			(cookies) => this.getAccessToken(cookies),
			() => this.accessToken,
			(token) => {
				this.accessToken = token;
			},
			this.accessSemaphore,
			cookies,
		);
		const elapsed = Date.now() - start;
		logs(
			"info",
			`Handled Spotify Token request from IP: ${ip}, UA: ${userAgent} (force: ${isForce}) in ${elapsed}ms`,
		);
		return result;
	};

	public clientTokenHonoHandler = async (c: Context): Promise<Response> => {
		const isForce = ["1", "yes", "true"].includes(
			(c.req.query("force") || "").toLowerCase(),
		);
		const connInfo = getConnInfo(c);
		let ip = connInfo?.remote?.address || "unknown";
		ip = this.normalizeIp(ip);
		const userAgent = c.req.header("user-agent") ?? "no ua";
		const start = Date.now();

		const result = await handleRequest(
			c,
			isForce,
			() => this.getClientToken(),
			() => this.clientToken,
			(token) => {
				this.clientToken = token;
			},
			this.clientSemaphore,
			undefined,
			(token) => token.raw,
		);
		const elapsed = Date.now() - start;
		logs(
			"info",
			`Handled Spotify Client Token request from IP: ${ip}, UA: ${userAgent} (force: ${isForce}) in ${elapsed}ms`,
		);
		return result;
	};
}
