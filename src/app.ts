import { Hono, type Context } from "hono";
import { SpotifyTokenHandler } from "./handler/spotify";
import { logs } from "./utils/logger";

const handler = new SpotifyTokenHandler();
const app = new Hono();

app.get("/spotifytoken", handler.honoHandler);

app.onError((err: unknown, c: Context) => {
	logs("error", err);
	return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
