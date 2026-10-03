# Movie Shelf — movie collection tracker

Tracks which movies you own and in which format (DVD, Blu-ray, 4K UHD, digital), whether a copy is owned or pirated, and a wishlist of new movies and upgrades. Metadata and posters come from TMDB. The Plex library is imported and rescanned nightly. media-pipeline reports new rips and encodes through a small API.

- **Collection:** a poster grid or table, filtered by format, ownership, HDR/Dolby Vision, editions and wishlist.
- **Movie page:** copies (format, ownership, edition, notes), the Plex files behind each copy, wishlist controls, and a button to add the movie to or remove it from your Plex watchlist (the plex.tv account behind `PLEX_TOKEN`).
- **Wishlist:** each item has a target of "Blu-ray is enough" or "4K only". Items are *new* or *upgrade* (you already own a lower format). An item is fulfilled automatically when a confirmed, owned copy in that format or better shows up. Each row also has a Plex watchlist toggle.
- **Upgrades:** movies you have on DVD only, pirated only, Blu-ray (4K candidates) or digital only, each with one-click wishlisting.
- **Review:** the Plex import guesses format and ownership from resolution, file naming (release groups, media-pipeline and MakeMKV names) and `.nfo` files. You confirm in bulk. Nothing counts as owned until it's confirmed.
- **Users:** you are the admin. Guests can browse the collection and wishlist but never see ownership or file paths.

## Stack

Astro 7 (server output, `@astrojs/node` standalone), Tailwind 4, SQLite via better-sqlite3 + Drizzle ORM, session auth with argon2, node-cron for the nightly rescan. Everything runs as one container with one `/data` volume.

## Development

```sh
npm install
cp .env.example .env   # set ADMIN_PASSWORD, TMDB_API_KEY, PLEX_URL/PLEX_TOKEN, DATA_DIR=./data
npm run dev            # http://localhost:4321
npm test               # classifier, path and wishlist rules
npm run check          # astro/TypeScript check
```

Schema changes: edit `src/db/schema.ts`, then run `npm run db:generate`. Migrations in `drizzle/` run automatically on startup.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / — | Creates the first admin when none exists |
| `TMDB_API_KEY` | — | v4 read token (`eyJ…`) or v3 key |
| `TMDB_LANGUAGE` | `en-US` | |
| `PLEX_URL` / `PLEX_TOKEN` | `http://host.docker.internal:32400` / — | The token is also used against plex.tv for the watchlist |
| `PLEX_SECTIONS` | all movie sections | Comma-separated titles or keys |
| `SCAN_CRON` | `30 4 * * *` | Nightly Plex rescan + TMDB refresh; empty disables it |
| `MEDIA_ROOT` | `/media` | Media mount used to read `.nfo` hints; empty disables it |
| `PATH_PREFIXES` | `/media/,/mnt/user/media/,/data/,M:/` | Stripped to make library-relative paths |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database location |

## API

Send `Authorization: Bearer <token>`. Tokens are created on the Settings page.

- `POST /api/v1/ingest`: register a rip or encode. It is idempotent per file path.
  ```json
  { "tmdb_id": 949, "stage": "triage|encoded", "format": "uhd", "edition": null, "ownership": "owned",
    "file": { "path": "M:\\Movies\\Heat (1995) {tmdb-949}\\Heat (1995).1080p.hevc.mkv",
              "width": 1920, "height": 800, "hdr": "none|hdr10|dv", "dv_profile": null, "size_bytes": 0 } }
  ```
  - `tmdb_id` and `edition` fall back to `{tmdb-N}` / `{edition-X}` in the path.
  - `format` is derived from the resolution when omitted. It never downgrades a copy registered at triage (a UHD disc encoded to 1080p stays UHD).
  - The file is matched to Plex's copy of it by the library-relative path.
- `GET /api/v1/movies/{tmdbId}`: what you have of a movie (copies, files, wishlist).
- `GET /api/v1/wishlist`: open wishlist items.
- `POST /api/v1/scan`: start a Plex rescan.
- `POST /api/v1/workers/{name}/claim` with `{ "capabilities": ["encode", "handoff"], "inventory": ["<folder>", …] }`: a worker asks for its next task from `/tasks`. Returns the task, or 204 when there is nothing to do (or it is paused or outside its hours).
- `PATCH /api/v1/tasks/{id}` with `{ "status"?: "done|failed", "log"?: "<new output>", "exitCode"?: 0, "error"?: "…" }`: progress, heartbeat (`{}`) or the end of a task. Returns `{ "cancel": true }` when it should stop.

The clients for media-pipeline are `tracker.py` (encode progress, ingest) and `worker.py` (tasks) in that repo.

## Deployment

A push to `main` makes GitHub Actions run the tests and publish `ghcr.io/bjornarvh/movie-collection-tracker:latest`. The stack lives in `unraid-compose/compose/movie-tracker/`. Deploy it with `docker compose pull && docker compose up -d`. Back up with that folder's `backup.sh`, which takes a SQLite online backup and copies it to Jottacloud.
