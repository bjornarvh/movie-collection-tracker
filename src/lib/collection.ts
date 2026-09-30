import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { copies, files, movies, wishlistItems, type Copy, type Format, type Movie, type Ownership } from '../db/schema';
import { getMovie, releaseYear, tmdbConfigured } from './tmdb';
import { fulfillingCopy, planWishlistItem } from './wishlist';

// ---- movies ---------------------------------------------------------------

export const findMovieByTmdb = (tmdbId: number) => db.select().from(movies).where(eq(movies.tmdbId, tmdbId)).get();

function tmdbFields(m: NonNullable<Awaited<ReturnType<typeof getMovie>>>) {
  return {
    title: m.title,
    originalTitle: m.original_title,
    year: releaseYear(m),
    overview: m.overview || null,
    runtime: m.runtime || null,
    genres: m.genres.map((g) => g.name),
    posterPath: m.poster_path,
    backdropPath: m.backdrop_path,
    imdbId: m.imdb_id,
    tmdbSyncedAt: new Date(),
  };
}

/**
 * Get or create the movie row for a TMDB id. New movies are filled from TMDB when it is
 * configured and reachable; otherwise `fallback` (e.g. title/year from Plex) is used and
 * TMDB sync is retried later by refreshStaleMovies().
 */
export async function ensureMovie(
  tmdbId: number,
  fallback?: { title: string; year?: number | null },
): Promise<{ movie: Movie; created: boolean }> {
  const existing = findMovieByTmdb(tmdbId);
  if (existing) return { movie: existing, created: false };
  let fields: Partial<typeof movies.$inferInsert> | null = null;
  if (tmdbConfigured()) {
    try {
      const m = await getMovie(tmdbId);
      if (m) fields = tmdbFields(m);
    } catch (err) {
      if (!fallback) throw err;
    }
  }
  if (!fields) {
    if (!fallback) throw new Error(`Movie ${tmdbId} not found on TMDB`);
    fields = { title: fallback.title, year: fallback.year ?? null };
  }
  // Another request may have inserted the same movie while we waited on TMDB.
  const inserted = db
    .insert(movies)
    .values({ tmdbId, title: fields.title!, ...fields })
    .onConflictDoNothing()
    .returning()
    .get();
  return inserted ? { movie: inserted, created: true } : { movie: findMovieByTmdb(tmdbId)!, created: false };
}

export async function refreshMovie(movieId: number) {
  const movie = db.select().from(movies).where(eq(movies.id, movieId)).get();
  if (!movie) return;
  const m = await getMovie(movie.tmdbId);
  if (m) db.update(movies).set(tmdbFields(m)).where(eq(movies.id, movieId)).run();
}

/** Re-sync movies never synced or synced more than `maxAgeDays` ago. */
export async function refreshStaleMovies(maxAgeDays = 30, limit = 200) {
  if (!tmdbConfigured()) return 0;
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 86400;
  const stale = db
    .select({ id: movies.id })
    .from(movies)
    .where(sql`${movies.tmdbSyncedAt} is null or ${movies.tmdbSyncedAt} < ${cutoff}`)
    .orderBy(asc(movies.tmdbSyncedAt))
    .limit(limit)
    .all();
  let n = 0;
  for (const { id } of stale) {
    try {
      await refreshMovie(id);
      n++;
    } catch {
      // keep going; a single TMDB failure shouldn't stop the batch
    }
  }
  return n;
}

// ---- copies -----------------------------------------------------------------

export type CopyInput = {
  format: Format;
  ownership: Ownership;
  edition?: string | null;
  notes?: string | null;
  origin: Copy['origin'];
  reviewStatus: Copy['reviewStatus'];
  suggestionReason?: string | null;
  confidence?: number | null;
};

export function addCopy(movieId: number, input: CopyInput) {
  const copy = db
    .insert(copies)
    .values({ movieId, ...input, edition: input.edition?.trim() || null })
    .returning()
    .get();
  const fulfilled = fulfillWishlist(movieId);
  return { copy, fulfilled };
}

export function updateCopy(copyId: number, patch: Partial<Omit<CopyInput, 'origin'>>) {
  const copy = db
    .update(copies)
    .set({ ...patch, ...(patch.edition !== undefined ? { edition: patch.edition?.trim() || null } : {}), updatedAt: new Date() })
    .where(eq(copies.id, copyId))
    .returning()
    .get();
  if (!copy) return { copy: null, fulfilled: [] };
  return { copy, fulfilled: fulfillWishlist(copy.movieId) };
}

export function deleteCopy(copyId: number) {
  db.delete(copies).where(eq(copies.id, copyId)).run();
}

export const movieCopies = (movieId: number) =>
  db.select().from(copies).where(eq(copies.movieId, movieId)).orderBy(desc(copies.createdAt)).all();

// ---- wishlist -------------------------------------------------------------

/** Marks open wishlist items for a movie as fulfilled when an owned copy satisfies them. */
export function fulfillWishlist(movieId: number) {
  const open = db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.movieId, movieId), isNull(wishlistItems.fulfilledAt)))
    .all();
  if (open.length === 0) return [];
  const owned = movieCopies(movieId);
  const fulfilled = [];
  for (const item of open) {
    const copy = fulfillingCopy(item, owned);
    if (!copy) continue;
    fulfilled.push(
      db
        .update(wishlistItems)
        .set({ fulfilledAt: new Date(), fulfilledByCopyId: copy.id })
        .where(eq(wishlistItems.id, item.id))
        .returning()
        .get(),
    );
  }
  return fulfilled;
}

export type WishlistResult = { ok: true; itemId: number } | { ok: false; reason: string };

/** Adds (or updates the open) wishlist item for a movie. */
export function addToWishlist(
  movieId: number,
  targetFormat: 'bluray' | 'uhd',
  opts: { priority?: number; notes?: string | null } = {},
): WishlistResult {
  const plan = planWishlistItem(targetFormat, movieCopies(movieId));
  if (!plan) return { ok: false, reason: 'You already own this movie in that format or better.' };
  const existing = db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.movieId, movieId), isNull(wishlistItems.fulfilledAt)))
    .get();
  const values = {
    ...plan,
    targetFormat,
    priority: opts.priority ?? existing?.priority ?? 2,
    notes: opts.notes !== undefined ? opts.notes?.trim() || null : (existing?.notes ?? null),
  };
  if (existing) {
    db.update(wishlistItems).set(values).where(eq(wishlistItems.id, existing.id)).run();
    return { ok: true, itemId: existing.id };
  }
  const row = db.insert(wishlistItems).values({ movieId, ...values }).returning().get();
  return { ok: true, itemId: row.id };
}

export function removeWishlistItem(itemId: number) {
  db.delete(wishlistItems).where(eq(wishlistItems.id, itemId)).run();
}

// ---- library views ----------------------------------------------------------

export type LibraryEntry = Movie & {
  copies: Copy[];
  fileCount: number;
  hdr: 'none' | 'hdr10' | 'dv';
  wish: typeof wishlistItems.$inferSelect | null;
};

/**
 * Loads every movie with its copies, file summary and open wishlist item. A personal
 * collection is a few thousand rows at most, so filtering happens in memory.
 */
export function loadLibrary(movieIds?: number[]): LibraryEntry[] {
  const where = movieIds ? inArray(movies.id, movieIds) : undefined;
  const allMovies = db.select().from(movies).where(where).orderBy(asc(movies.title)).all();
  const copyRows = db.select().from(copies).where(movieIds ? inArray(copies.movieId, movieIds) : undefined).all();
  const fileRows = db
    .select({ movieId: files.movieId, hdr: files.hdr, missing: files.missing })
    .from(files)
    .where(movieIds ? inArray(files.movieId, movieIds) : undefined)
    .all();
  const wishRows = db.select().from(wishlistItems).where(isNull(wishlistItems.fulfilledAt)).all();

  const byMovie = <T extends { movieId: number }>(rows: T[]) => {
    const map = new Map<number, T[]>();
    for (const r of rows) map.set(r.movieId, [...(map.get(r.movieId) ?? []), r]);
    return map;
  };
  const copyMap = byMovie(copyRows);
  const fileMap = byMovie(fileRows);
  const wishMap = new Map(wishRows.map((w) => [w.movieId, w]));

  return allMovies.map((m) => {
    const fs = (fileMap.get(m.id) ?? []).filter((f) => !f.missing);
    const hdr = fs.some((f) => f.hdr === 'dv') ? 'dv' : fs.some((f) => f.hdr === 'hdr10') ? 'hdr10' : 'none';
    return { ...m, copies: copyMap.get(m.id) ?? [], fileCount: fs.length, hdr, wish: wishMap.get(m.id) ?? null };
  });
}

export const reviewCount = () =>
  db.select({ n: sql<number>`count(*)` }).from(copies).where(eq(copies.reviewStatus, 'needs_review')).get()?.n ?? 0;
