export interface SpotifyToken {
	accessToken: string;
	accessTokenExpirationTimestampMs: number;
	clientId?: string;
	isAnonymous?: boolean;
	[key: string]: unknown;
}

export interface TokenProxy<T extends SpotifyToken> {
	fetch: (cookies?: Array<{ name: string; value: string }>) => Promise<T>;
	readonly data: T | undefined;
	valid(): boolean;
	refresh(): Promise<T>;
}

export interface ClientTokenGranted {
	token: string;
	expires_after_seconds: number;
	refresh_after_seconds?: number;
	domains?: Array<{ domain: string }>;
}

export interface ClientTokenResponse {
	response_type: string;
	granted_token: ClientTokenGranted;
	[key: string]: unknown;
}

export interface SpotifyClientToken extends SpotifyToken {
	raw: ClientTokenResponse;
	refreshAfterTimestampMs?: number;
}
