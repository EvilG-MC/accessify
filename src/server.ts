import "dotenv/config";

import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { SpotifyTokenHandler } from "./handler/spotify";
import { logs } from "./utils/logger";

const handler = new SpotifyTokenHandler();
const app = new Hono();

app.get("/spotifytoken", handler.honoHandler);
app.get("/clienttoken", handler.clientTokenHonoHandler);

app.onError((err: unknown, c: Context) => {
	logs("error", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

const PORT = Number(process.env.SERVER_PORT) || 3000;

// Cleanup function
async function cleanup() {
	logs("info", "Shutting down server...");
	await handler.cleanup();
	process.exit(0);
}

// Handle graceful shutdown
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

serve({ fetch: app.fetch, port: PORT });
logs("info", `Spotify Token API (Hono) listening on http://localhost:${PORT}`);
