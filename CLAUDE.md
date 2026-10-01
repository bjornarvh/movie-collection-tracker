# CLAUDE.md

Personal movie collection tracker. See README.md for features, configuration and the API.

## Commands

```sh
npm run dev      # dev server on :4321 (reads .env via process.loadEnvFile)
npm test         # vitest: tests/*.test.ts, pure logic only
npm run check    # astro check (TypeScript 6 — @astrojs/check doesn't support TS 7 yet)
npm run build    # production build → dist/server/entry.mjs
npm run db:generate  # after editing src/db/schema.ts
```

## Architecture

- **Server-rendered Astro pages** handle their own form POSTs in the frontmatter, then redirect back with `?ok=`/`?err=` flash messages (`src/lib/forms.ts`).
  - Client JS exists in only two places: the select-all script on /review, and the poller on /encodes.
  - Keep it that way unless a page really needs interactivity.
- **The /encodes poller doesn't render anything itself.**
  - It fetches `/encodes/current`, a `partial` Astro page holding the same `CurrentEncode` component, and swaps it in.
  - It polls every 5 s while a batch is live and every 30 s otherwise, so a newly started batch shows up without a reload.
- **Encode tracking** (`encode_runs` and `encode_jobs`, `src/lib/encodes.ts`) is fed live by media-pipeline's `compress_media.py`.
  - `POST /api/v1/encodes` registers the batch and its queue.
  - `PATCH /api/v1/encodes/{run}/jobs/{job}` reports status and progress, changing only the fields sent.
  - `PATCH /api/v1/encodes/{run}` finishes the batch. With `{}` it is a heartbeat.
  - `GET /api/v1/encodes/current` returns the newest batch.
  - A running batch quiet for 10 min is shown as **stalled**. That is computed at read time, so it needs no cron (`runState`).
  - The next batch from the same host closes stalled batches as aborted.
  - Pure logic lives in `encode-progress.ts`, which has no db import, so vitest can load it.
- **`src/middleware.ts`** handles all auth.
  - API routes accept `Bearer` tokens.
  - Pages use the session cookie.
  - Guests are read-only and can't reach `/add`, `/review`, `/settings`, `/upgrades`, `/encodes` or `/api`.
  - Cookie-authenticated writes need a same-origin `Origin`/`Referer`. Astro's own `checkOrigin` is off because it fails behind Caddy's TLS.
- **Config is read from `process.env` at runtime** (`src/lib/config.ts`). Never read it from `import.meta.env`, which is inlined at build time.
- **Data model:**
  - A `copies` row is something you own (disc, digital, or pirated).
  - A `files` row is a video in the library, from Plex or media-pipeline.
  - A file links to at most one copy.
  - Plex rescans only update technical fields on files. They never change a copy after it exists, so review decisions survive rescans.
  - `files.rel_path` (library-relative, forward slashes) is how Plex and media-pipeline reports meet (`src/lib/paths.ts`).
- **Wishlist rules** (`src/lib/wishlist.ts`): only `owned` + `confirmed` copies count. Format rank is dvd < digital < bluray < uhd.
- **Guests must never see ownership (owned/pirated) or file paths.** Check `isAdmin` before rendering either.

## Gotchas

- The Bash tool on this machine collapses `\\` in heredocs. Write regex- or JSON-heavy files with the editor.
- The classifier (`src/lib/classify.ts`) is tested against real file names from `M:\Movies`. Add a test case when you change a rule.
- The local Plex server for testing is `http://192.168.86.10:32400`. Its movie section includes both `/media/Movies` and `/media/Movies-queue`.
