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
    /** Runtime from Plex, so /reencode can rank files by size per hour. */
    durationS: integer('duration_s'),
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

/**
 * A machine running media-pipeline's worker.py. Workers poll for tasks; nothing
 * ever calls into them, so the desktop needs no open port.
 */
export const workers = sqliteTable('workers', {
  name: text('name').primaryKey(),
  /** Task types the worker said it can run, sent with every poll. */
  capabilities: text('capabilities', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Folders it can encode from (`_to_encode` on the desktop, `_encode` on the server). */
  inventory: text('inventory', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  /** Show and season folders per library it can re-encode, e.g. {"TV Shows": ["Shogun {tmdb-1}/Season 01"]}. */
  libraries: text('libraries', { mode: 'json' }).$type<Record<string, string[]>>().notNull().default(sql`'{}'`),
  /** Paused workers keep running what they have but claim nothing new. */
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  /** Local hours it may start tasks, e.g. "22-7"; null = any time. */
  allowedHours: text('allowed_hours'),
  lastSeenAt: timestamp('last_seen_at'),
});

export const TASK_TYPES = ['encode', 'handoff', 'reencode', 'purge-original', 'restore-original', 'ytdlp'] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A unit of work queued from the tracker and run by one named worker. */
export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: TASK_TYPES }).notNull(),
    /** Which worker runs it: the encode form's desktop/server choice. */
    worker: text('worker').notNull(),
    params: text('params', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('queued'),
    /** A short label for lists, e.g. the folder name. */
    title: text('title').notNull(),
    createdAt: timestamp('created_at').notNull().default(now),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    /** Bumped by every report from the worker; a running task that goes quiet is stalled. */
    lastSeenAt: timestamp('last_seen_at'),
    exitCode: integer('exit_code'),
    log: text('log').notNull().default(''),
    error: text('error'),
    /** What the worker reported back, e.g. reencode.py's per-file summary. */
    result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
    cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
    /** The task this one was queued by (a handoff queues the server encode). */
    parentId: integer('parent_id'),
  },
  (t) => [index('tasks_queue_idx').on(t.worker, t.status, t.id)],
);

export type Worker = typeof workers.$inferSelect;
export type Task = typeof tasks.$inferSelect;

export type Movie = typeof movies.$inferSelect;
export type Copy = typeof copies.$inferSelect;
export type MediaFile = typeof files.$inferSelect;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type User = typeof users.$inferSelect;
