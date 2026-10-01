import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const FORMATS = ['dvd', 'digital', 'bluray', 'uhd'] as const;
export type Format = (typeof FORMATS)[number];

export const OWNERSHIPS = ['owned', 'pirated', 'unverified'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export const HDR_TYPES = ['none', 'hdr10', 'dv'] as const;
export type Hdr = (typeof HDR_TYPES)[number];

const now = sql`(unixepoch())`;
const timestamp = (name: string) => integer(name, { mode: 'timestamp' });

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'guest'] }).notNull(),
  createdAt: timestamp('created_at').notNull().default(now),
});

export const sessions = sqliteTable('sessions', {
  /** sha256 of the cookie token; the raw token is never stored. */
  id: text('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at').notNull().default(now),
  lastUsedAt: timestamp('last_used_at'),
});

export const movies = sqliteTable('movies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  imdbId: text('imdb_id'),
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  year: integer('year'),
  overview: text('overview'),
  runtime: integer('runtime'),
  genres: text('genres', { mode: 'json' }).$type<string[]>(),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  tmdbSyncedAt: timestamp('tmdb_synced_at'),
  createdAt: timestamp('created_at').notNull().default(now),
});

/** Something you have: a disc on the shelf, a digital purchase, or a pirated file. */
export const copies = sqliteTable(
  'copies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    format: text('format', { enum: FORMATS }).notNull(),
    ownership: text('ownership', { enum: OWNERSHIPS }).notNull(),
    edition: text('edition'),
    notes: text('notes'),
    origin: text('origin', { enum: ['manual', 'plex', 'pipeline'] }).notNull(),
    reviewStatus: text('review_status', { enum: ['confirmed', 'needs_review'] }).notNull(),
    suggestionReason: text('suggestion_reason'),
    confidence: real('confidence'),
    createdAt: timestamp('created_at').notNull().default(now),
    updatedAt: timestamp('updated_at').notNull().default(now),
  },
  (t) => [index('copies_movie_idx').on(t.movieId), index('copies_review_idx').on(t.reviewStatus)],
);

/** A video file in the library (from Plex or media-pipeline), optionally backing a copy. */
export const files = sqliteTable(
  'files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    copyId: integer('copy_id').references(() => copies.id, { onDelete: 'set null' }),
    /** Path relative to the media root, forward slashes, e.g. "Movies/Heat (1995) {tmdb-949}/Heat (1995).mkv". */
    relPath: text('rel_path').notNull().unique(),
    source: text('source', { enum: ['plex', 'pipeline'] }).notNull(),
    plexRatingKey: text('plex_rating_key'),
    plexMediaId: text('plex_media_id'),
    plexUpdatedAt: integer('plex_updated_at'),
    width: integer('width'),
    height: integer('height'),
    hdr: text('hdr', { enum: HDR_TYPES }),
    dvProfile: integer('dv_profile'),
    codec: text('codec'),
    container: text('container'),
    sizeBytes: integer('size_bytes'),
    parts: integer('parts').notNull().default(1),
    edition: text('edition'),
    missing: integer('missing', { mode: 'boolean' }).notNull().default(false),
    firstSeenAt: timestamp('first_seen_at').notNull().default(now),
    lastSeenAt: timestamp('last_seen_at').notNull().default(now),
  },
  (t) => [
    index('files_movie_idx').on(t.movieId),
    index('files_copy_idx').on(t.copyId),
    uniqueIndex('files_plex_media_idx').on(t.plexMediaId),
  ],
);

export const wishlistItems = sqliteTable(
  'wishlist_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['new', 'upgrade'] }).notNull(),
    /** Lowest format that satisfies this item: 'bluray' = "Blu-ray is enough", 'uhd' = "4K only". */
    targetFormat: text('target_format', { enum: ['bluray', 'uhd'] }).notNull(),
    fromCopyId: integer('from_copy_id').references(() => copies.id, { onDelete: 'set null' }),
    /** 1 = high, 2 = normal, 3 = low */
    priority: integer('priority').notNull().default(2),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().default(now),
    fulfilledAt: timestamp('fulfilled_at'),
    fulfilledByCopyId: integer('fulfilled_by_copy_id').references(() => copies.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('wishlist_movie_idx').on(t.movieId)],
);

export type ScanStats = {
  sections: string[];
  items: number;
  newMovies: number;
  newFiles: number;
  updatedFiles: number;
  missingFiles: number;
  skipped: number;
  errors: number;
};

export const scanRuns = sqliteTable('scan_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger', { enum: ['manual', 'schedule'] }).notNull(),
  status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
  startedAt: timestamp('started_at').notNull().default(now),
  finishedAt: timestamp('finished_at'),
  stats: text('stats', { mode: 'json' }).$type<ScanStats>(),
  log: text('log'),
});

export const ENCODE_RUN_STATUSES = ['running', 'finished', 'aborted'] as const;
export const ENCODE_JOB_STATUSES = ['queued', 'running', 'done', 'skipped', 'failed'] as const;
export type EncodeJobStatus = (typeof ENCODE_JOB_STATUSES)[number];

/** One `compress_media.py` batch, reported live by media-pipeline. */
export const encodeRuns = sqliteTable('encode_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  host: text('host').notNull(),
  inputRoot: text('input_root'),
  outputRoot: text('output_root'),
  encoder: text('encoder'),
  options: text('options', { mode: 'json' }).$type<Record<string, unknown>>(),
  status: text('status', { enum: ENCODE_RUN_STATUSES }).notNull(),
  startedAt: timestamp('started_at').notNull().default(now),
  finishedAt: timestamp('finished_at'),
  /** Bumped by every report; a running batch that goes quiet is shown as stalled. */
  lastSeenAt: timestamp('last_seen_at').notNull().default(now),
  done: integer('done').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  failed: integer('failed').notNull().default(0),
});

/** One output file of a batch. A stacked multi-part movie is a single job. */
export const encodeJobs = sqliteTable(
  'encode_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => encodeRuns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Output path relative to the library root, forward slashes. */
    relPath: text('rel_path').notNull(),
    parts: integer('parts').notNull().default(1),
    tmdbId: integer('tmdb_id'),
    status: text('status', { enum: ENCODE_JOB_STATUSES }).notNull().default('queued'),
    stage: text('stage'),
    percent: real('percent'),
    speed: real('speed'),
    fps: real('fps'),
    outTimeS: real('out_time_s'),
    durationS: real('duration_s'),
    description: text('description'),
    error: text('error'),
    sizeBytes: integer('size_bytes'),
    gbPerHour: real('gb_per_hour'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [index('encode_jobs_run_idx').on(t.runId, t.position)],
);

export type EncodeRun = typeof encodeRuns.$inferSelect;
export type EncodeJob = typeof encodeJobs.$inferSelect;

export type Movie = typeof movies.$inferSelect;
export type Copy = typeof copies.$inferSelect;
export type MediaFile = typeof files.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type User = typeof users.$inferSelect;
