# CLAUDE.md

Personal movie collection tracker. See README.md for features, configuration and the API.

## Commands

pnpm only (`packageManager` in package.json; CI installs with `--frozen-lockfile`), so don't create a `package-lock.json`.

```sh
pnpm dev         # dev server on :4321 (reads .env via process.loadEnvFile)
pnpm test        # vitest: tests/*.test.ts, pure logic only
pnpm vitest run tests/classify.test.ts   # one file; add -t "<name>" for one test
pnpm run check   # astro check (TypeScript 6 — @astrojs/check doesn't support TS 7 yet)
pnpm build       # production build → dist/server/entry.mjs
pnpm db:generate # after editing src/db/schema.ts
```

CI runs `pnpm test` and `pnpm run check` on every push and PR. A push to `main` also publishes `ghcr.io/bjornarvh/movie-collection-tracker:latest`, which the server runs (`../unraid-compose/compose/movie-tracker/`).

## Architecture

- **Server-rendered Astro pages** handle their own form POSTs in the frontmatter, then redirect back with `?ok=`/`?err=` flash messages (`src/lib/forms.ts`).
  - Client JS exists in only three places: the select-all script on /review, the poller on /encodes, and the 5 s reload on a live /tasks/{id}.
  - Keep it that way unless a page really needs interactivity.
- **The /encodes poller doesn't render anything itself.**
  - It fetches `/encodes/current`, a `partial` Astro page holding the same `CurrentEncode` component, and swaps it in.
  - It polls every second while a batch is live (the pipeline sends progress once a second too) and every 30 s otherwise, so a newly started batch shows up without a reload.
- **Encode tracking** (`encode_runs` and `encode_jobs`, `src/lib/encodes.ts`) is fed live by media-pipeline's `compress_media.py`.
  - `POST /api/v1/encodes` registers the batch and its queue.
  - `PATCH /api/v1/encodes/{run}/jobs/{job}` reports status and progress, changing only the fields sent.
  - `PATCH /api/v1/encodes/{run}` finishes the batch. With `{}` it is a heartbeat.
  - `GET /api/v1/encodes/current` returns the newest batch.
  - A running batch quiet for 10 min is shown as **stalled**. That is computed at read time, so it needs no cron (`runState`).
  - The next batch from the same host closes stalled batches as aborted.
  - Pure logic lives in `encode-progress.ts`, which has no db import, so vitest can load it.
- **The task queue (`/tasks`) runs encodes on the desktop or the server**, through media-pipeline's `worker.py`.
  - Workers poll: `POST /api/v1/workers/{name}/claim` records the worker's capabilities and encodable folders (`workers.inventory`) and hands out its oldest queued task. `PATCH /api/v1/tasks/{id}` appends output (capped tail, `appendLog`), heartbeats, finishes, and answers `cancel`.
  - **A task is a type plus zod-validated params** (`src/lib/task-queue.ts`), never a command. Folder names are refused if they could leave a root, and the worker checks again against its own config.
  - Workers are named `desktop` (NVENC) and `server` (x265). Choosing the server for a folder that is only on the desktop queues a `handoff` (copy to `_encode`); when it finishes, `updateTask` queues the server encode with `parent_id` set.
  - Pause and allowed hours (`"22-7"`, server local time) only stop new claims; cancel stops a running task within a heartbeat.
  - **A claim closes that worker's tasks still marked running.** An idle worker has none, so those died with a restart. A quiet running task shows as **stalled** after 10 min, computed at read time (`taskState`), like encode runs.
  - The tables are named `tasks`/`workers`, separate from `encode_jobs`: an encode task's live progress still arrives through the `/api/v1/encodes` endpoints.
- **`src/middleware.ts`** handles all auth.
  - API routes accept `Bearer` tokens.
  - Pages use the session cookie.
  - Guests are read-only and can't reach `/add`, `/review`, `/settings`, `/upgrades`, `/encodes`, `/to-rip`, `/tasks` or `/api`.
  - Cookie-authenticated writes need a same-origin `Origin`/`Referer`. Astro's own `checkOrigin` is off because it fails behind Caddy's TLS.
- **Config is read from `process.env` at runtime** (`src/lib/config.ts`). Never read it from `import.meta.env`, which is inlined at build time.
- **Data model:**
  - A `copies` row is something you own (disc, digital, or pirated).
  - A `files` row is a video in the library, from Plex or media-pipeline.
  - A file links to at most one copy.
  - Plex rescans only update technical fields on files. They never change a copy after it exists, so review decisions survive rescans.
  - `files.rel_path` (library-relative, forward slashes) is how Plex and media-pipeline reports meet (`src/lib/paths.ts`).
- **To rip** (`/to-rip`, rules in `src/lib/rip-queue.ts`) lists owned, confirmed disc copies with no non-missing file.
  - It is decided **per copy, not per movie**: a UHD you bought of a film whose library file is a download still needs ripping.
  - Discs get there via `/add` or the bulk paste on `/add/bulk`.
  - A disc only leaves the list if its rip is linked to *that* copy. So both ways a file arrives fall back to `discForNewFile`, which picks the disc a file plausibly came off: same edition, not named like a download, and no higher resolution than the disc.
    - A new Plex file is linked to the disc instead of getting a needs-review copy of its own.
    - In `ingest`, it is the last fallback, because `compress_media.py` sends no format.
  - Attaching never edits the copy, so a 1080p encode of a UHD disc leaves the disc marked UHD.
- **Wishlist rules** (`src/lib/wishlist.ts`): only `owned` + `confirmed` copies count. Format rank is dvd < digital < bluray < uhd.
- **Guests must never see ownership (owned/pirated) or file paths.** Check `isAdmin` before rendering either.

## Gotchas

- The Bash tool on this machine collapses `\\` in heredocs. Write regex- or JSON-heavy files with the editor.
- The classifier (`src/lib/classify.ts`) is tested against real file names from `M:\Movies`. Add a test case when you change a rule.
- The local Plex server for testing is `http://192.168.86.10:32400`. Its movie section includes both `/media/Movies` and `/media/Movies-queue`.
