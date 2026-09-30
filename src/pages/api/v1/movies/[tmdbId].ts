import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db/client';
import { files } from '../../../../db/schema';
import { findMovieByTmdb, loadLibrary } from '../../../../lib/collection';
import { bestOwned } from '../../../../lib/formats';
import { countsAsOwned } from '../../../../lib/wishlist';
import { json } from '../_json';

/** What you have of a movie, e.g. for triage to warn "you already own this on 4K". */
export const GET: APIRoute = ({ params }) => {
  const movie = findMovieByTmdb(Number(params.tmdbId));
  if (!movie) return json({ tmdb_id: Number(params.tmdbId), in_collection: false, copies: [], wishlist: null });
  const [entry] = loadLibrary([movie.id]);
  const fileRows = db.select().from(files).where(eq(files.movieId, movie.id)).all();
  return json({
    tmdb_id: movie.tmdbId,
    title: movie.title,
    year: movie.year,
    in_collection: entry.copies.length > 0,
    // Only confirmed copies count, same as wishlist fulfilment.
    best_owned_format: bestOwned(entry.copies.filter(countsAsOwned)),
    copies: entry.copies.map((c) => ({
      id: c.id,
      format: c.format,
      ownership: c.ownership,
      edition: c.edition,
      review_status: c.reviewStatus,
      origin: c.origin,
      files: fileRows
        .filter((f) => f.copyId === c.id)
        .map((f) => ({ rel_path: f.relPath, width: f.width, height: f.height, hdr: f.hdr, missing: f.missing })),
    })),
    wishlist: entry.wish && { kind: entry.wish.kind, target_format: entry.wish.targetFormat, priority: entry.wish.priority },
  });
};
