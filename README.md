# Accessify

> **Credit:** This project is based on [devoxin/anonify](https://github.com/devoxin/anonify) with refactoring and adaptation for LavaSrc and general Spotify access token needs.

A simple REST API to generate and cache anonymous Spotify access tokens using Playwright. This project is primarily designed for use as a custom anonymous token endpoint for [LavaSrc](https://github.com/topi314/LavaSrc) on Lavalink, but can be used in any application or service that needs a fresh Spotify access token.

> **Alternative:** For a compiled/binary version, you can use [accessify-rs](https://github.com/idMJA/accessify-rs) — a Rust port of this project.

## Features
- Generate anonymous Spotify access tokens (browser automation, Playwright)
- Designed for seamless integration with LavaSrc/Lavalink (`customTokenEndpoint`)
- Can be used by any service needing a Spotify access token
- Token caching with force refresh support
- Concurrency-safe (Semaphore)
- Fast REST API (Hono framework)
- TypeScript, modular and maintainable structure

## Requirements
- Node.js 18+
- Chromium browser (see below for installation instructions)

## Install dependencies

```bash
npm install
```

## Chromium Installation

### For most environments
Install Playwright's bundled Chromium automatically:

```bash
npx playwright install chromium
```

### For Pterodactyl / Pelican / Wings-based panels (restricted environments)
Standard `npx playwright install chromium` won't work in these environments due to `/tmp` size limitations and lack of root access. Use the provided setup scripts instead.

**Option A — Automatic (recommended):**

Run the all-in-one setup script to download Chrome and install all missing system libraries automatically:

```bash
node scripts/setup.js [chrome-version]
# Example:
node scripts/setup.js 133.0.6943.98
```

**Option B — Manual step by step:**

1. Download Chrome:
```bash
node scripts/setup-chrome.js [chrome-version]
```

2. Install missing system libraries:
```bash
node scripts/setup-libs.js
```

**After running the setup scripts**, add this at the very top of your app **before any other `require`**:

```js
process.env.LD_LIBRARY_PATH = '/home/container/libs';
```

Or set it in your `.env`:
```properties
LD_LIBRARY_PATH=/home/container/libs
CHROME_PATH=/home/container/chrome-linux64/chrome
```

> **Note:** The setup scripts only need to be run once. On subsequent restarts, Chrome and its libraries will already be in place.

## Build & Run

```bash
npm start
```

## API Usage

- **GET /spotifytoken**
  - Returns a cached Spotify access token (auto-refresh if expired)

Example:
```bash
curl http://localhost:3000/spotifytoken
```

## Integration: LavaSrc Custom Anonymous Token Endpoint

This API can be used as a custom anonymous token endpoint for [LavaSrc](https://github.com/topi314/LavaSrc) and Lavalink (see [LavaSrc PR #286](https://github.com/topi314/LavaSrc/pull/286)).

**Example LavaSrc on Lavalink config:**
```yaml
spotify:
  preferAnonymousToken: true
  customTokenEndpoint: "http://localhost:3000/spotifytoken"
```

## Notes
- For deployment on server/CI, make sure Chromium is available:
  - Use `npx playwright install chromium` for most environments.
  - For Pterodactyl/Pelican/Wings-based panels, use the provided setup scripts.
- Request logs include IP and user-agent.

---
