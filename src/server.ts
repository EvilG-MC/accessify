import "dotenv/config";

import { Hono, type Context } from "hono";
import { SpotifyTokenHandler } from "./handler/spotify";
import { logs } from "./utils/logger";
import { serve } from "@hono/node-server";

const handler = new SpotifyTokenHandler();
const app = new Hono();

app.get("/spotifytoken", handler.honoHandler);

app.onError((err: unknown, c: Context) => {
	logs("error", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

const PORT = Number(process.env.PORT) || 3000;

if (require.main === module) {
	serve({ fetch: app.fetch, port: PORT });
	logs(
		"info",
		`Spotify Token API (Hono) listening on http://localhost:${PORT}`,
	);
}
