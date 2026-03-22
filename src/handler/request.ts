import type { Context } from "hono";
import type { SpotifyToken, TokenProxy } from "../types/spotify";
import { logs } from "../utils/logger";
import type { Semaphore } from "../utils/semaphore";

export async function handleRequest<T extends SpotifyToken>(
	c: Context,
	isForce: boolean,
	getToken: (cookies?: Array<{ name: string; value: string }>) => Promise<T>,
	getCachedToken: () => T | undefined,
	setCachedToken: (token: T) => void,
	semaphore: Semaphore,
	cookies?: Array<{ name: string; value: string }>,
	serializer?: (token: T) => unknown,
): Promise<Response> {
	const token: TokenProxy<T> = {
		fetch: () => getToken(cookies),
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

	if (cookies && cookies.length > 0) {
		const release = await semaphore.acquire();
		try {
			const freshToken = await token.refresh();
			return c.json(serializer ? serializer(freshToken) : freshToken, 200);
		} catch (e) {
			logs("error", e);
			return c.json({ error: "Failed to fetch token" }, 500);
		} finally {
			release();
		}
	}

	if (!isForce && token.valid()) {
		return c.json(
			token.data ? (serializer ? serializer(token.data) : token.data) : {},
			200,
		);
	}

	const release = await semaphore.acquire();
	try {
		if (!isForce && token.valid()) {
			return c.json(
				token.data ? (serializer ? serializer(token.data) : token.data) : {},
				200,
			);
		}

		const refreshed = await token.refresh();
		return c.json(serializer ? serializer(refreshed) : refreshed, 200);
	} catch (e) {
		logs("error", e);
		return c.json({ error: "Failed to fetch token" }, 500);
	} finally {
		release();
	}
}
