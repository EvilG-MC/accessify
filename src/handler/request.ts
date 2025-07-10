import type { Context } from "hono";
import type { SpotifyToken, TokenProxy } from "../types/spotify";
import { logs } from "../utils/logger";
import type { Semaphore } from "../utils/semaphore";

export async function handleRequest(
	c: Context,
	isForce: boolean,
	getToken: () => Promise<SpotifyToken>,
	getCachedToken: () => SpotifyToken | undefined,
	setCachedToken: (token: SpotifyToken) => void,
	semaphore: Semaphore,
): Promise<Response> {
	const token: TokenProxy = {
		type: "cachedAccessToken",
		fetch: getToken,
		get data() {
			return getCachedToken();
		},
		valid() {
			return (
				(this.data?.accessTokenExpirationTimestampMs || 0) - 10000 > Date.now()
			);
		},
		async refresh() {
			const data = await this.fetch();
			setCachedToken(data);
			return data;
		},
	};

	if (!isForce && token.valid()) {
		return c.json(token.data, 200);
	}

	const release = await semaphore.acquire();
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
}
