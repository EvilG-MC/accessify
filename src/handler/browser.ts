import playwright from "playwright";
import type { Browser, LaunchOptions, Page, Request } from "playwright";
import { contextLogWithUndefined } from "../utils/logger";
import type { SpotifyToken } from "../types/spotify";

export class SpotifyBrowser {
	public fetchToken = (): Promise<SpotifyToken> => {
		return new Promise<SpotifyToken>((resolve, reject) => {
			const run = async () => {
				const executablePath =
					process.env.BROWSER_PATH && process.env.BROWSER_PATH.trim() !== ""
						? process.env.BROWSER_PATH
						: undefined;
				const launchOptions: LaunchOptions = {
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
				};
				if (executablePath) launchOptions.executablePath = executablePath;

				let browser: Browser | undefined;
				try {
					browser = await playwright.chromium.launch(launchOptions);
				} catch (err) {
					contextLogWithUndefined("Failed to spawn browser", err);
					return reject(new Error("Failed to launch browser"));
				}

				let page: Page | undefined;
				try {
					page = await browser.newPage();
				} catch (err) {
					contextLogWithUndefined("Failed to open new page", err);
					await browser.close();
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
						contextLogWithUndefined(
							"Deadline exceeded without processing access token request, did the endpoint change?",
							undefined,
						);
					}
					browser.close();
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
						browser.close();
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
					await browser.close();
					clearTimeout(timeout);
					resolve(json as SpotifyToken);
				});

				page.goto("https://open.spotify.com/").catch(async (err: unknown) => {
					if (!processedAccessTokenRequest) {
						browser.close();
						clearTimeout(timeout);
						reject(new Error(`Failed to goto URL: ${err}`));
					}
				});
			};
			run();
		});
	};
}
