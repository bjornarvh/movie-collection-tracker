import type { APIRoute } from 'astro';
import { eq, isNull } from 'drizzle-orm';
import { db } from '../../../db/client';
import { movies, wishlistItems } from '../../../db/schema';
import { json } from './_json';

export const GET: APIRoute = () => {
  const rows = db
    .select({ item: wishlistItems, movie: movies })
    .from(wishlistItems)
    .innerJoin(movies, eq(movies.id, wishlistItems.movieId))
    .where(isNull(wishlistItems.fulfilledAt))
    .all();
  return json(
    rows.map(({ item, movie }) => ({
      tmdb_id: movie.tmdbId,
      title: movie.title,
      year: movie.year,
      kind: item.kind,
      target_format: item.targetFormat,
      priority: item.priority,
      notes: item.notes,
    })),
  );
};
