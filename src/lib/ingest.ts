import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { files, FORMATS, HDR_TYPES, OWNERSHIPS, type Copy } from '../db/schema';
import { classify } from './classify';
import { addCopy, ensureMovie, movieCopies, updateCopy } from './collection';
import { config } from './config';
import { editionKey, FORMAT_RANK } from './formats';
import { baseName, normalizeRelPath, parsePlexNaming } from './paths';

export const ingestSchema = z.object({
  tmdb_id: z.number().int().positive().optional(),
  /** "triage" = ripped and sorted, not encoded yet; "encoded" = final file in the library. */
  stage: z.enum(['triage', 'encoded']).default('encoded'),
  edition: z.string().trim().max(200).nullish(),
  /** Physical source of the rip. Omit to derive it from the resolution. */
  format: z.enum(FORMATS).nullish(),
  ownership: z.enum(OWNERSHIPS).default('owned'),
  notes: z.string().max(2000).nullish(),
  file: z
    .object({
      /** Absolute (M:\Movies\...) or library-relative (Movies/...) path. */
      path: z.string().min(1).max(1000),
      width: z.number().int().positive().nullish(),
      height: z.number().int().positive().nullish(),
      hdr: z.enum(HDR_TYPES).nullish(),
      dv_profile: z.number().int().nullish(),
      codec: z.string().max(50).nullish(),
      size_bytes: z.number().int().nonnegative().nullish(),
      parts: z.number().int().positive().nullish(),
    })
    .nullish(),
});

export type IngestRequest = z.infer<typeof ingestSchema>;

export class IngestError extends Error {}

/**
 * Picks an existing copy the pipeline is reporting on: same edition, no file yet
 * (e.g. registered at triage, or a disc you added by hand), preferring the same format.
 */
function matchCopy(candidates: Copy[], linkedCopyIds: Set<number>, edition: string | null, format: string | null) {
  const open = candidates.filter((c) => !linkedCopyIds.has(c.id) && editionKey(c.edition) === editionKey(edition) && c.ownership !== 'pirated');
  return (
    open.find((c) => c.format === format) ??
    open.filter((c) => c.origin === 'pipeline').sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])[0] ??
    null
  );
}

export async function ingest(req: IngestRequest) {
  const relPath = req.file ? normalizeRelPath(req.file.path, config.pathPrefixes) : null;
  const naming = relPath ? parsePlexNaming(relPath) : { tmdbId: null, edition: null };
  const tmdbId = req.tmdb_id ?? naming.tmdbId;
  if (!tmdbId) throw new IngestError('tmdb_id is required (or a file path containing {tmdb-N})');
  const edition = req.edition?.trim() || naming.edition || null;

  const { movie, created: movieCreated } = await ensureMovie(tmdbId);

  const derived = req.file
    ? classify({ fileName: baseName(relPath!), width: req.file.width, height: req.file.height, sizeBytes: req.file.size_bytes })
    : null;
  const format = req.format ?? derived?.format ?? null;
  if (!format) throw new IngestError('format is required when no file resolution is given');

  const existingFile = relPath ? db.select().from(files).where(eq(files.relPath, relPath)).get() : undefined;
  const all = movieCopies(movie.id);
  const linked = new Set(
    db
      .select({ copyId: files.copyId })
      .from(files)
      .where(eq(files.movieId, movie.id))
      .all()
      .map((f) => f.copyId)
      .filter((id): id is number => id !== null),
  );

  // The copy this report is about: the one already backing the file, or a matching open one.
  const target =
    (existingFile?.copyId ? all.find((c) => c.id === existingFile.copyId) : undefined) ??
    matchCopy(all, linked, edition, req.format ?? null);

  const copyValues = {
    format,
    ownership: req.ownership,
    edition,
    reviewStatus: 'confirmed' as const,
    suggestionReason: `media-pipeline (${req.stage})`,
    confidence: 1,
    ...(req.notes ? { notes: req.notes } : {}),
  };
  // Don't let a resolution-derived format downgrade a format you set (e.g. UHD disc encoded to 1080p).
  if (target && !req.format && target.reviewStatus === 'confirmed') copyValues.format = target.format;

  const result = target ? updateCopy(target.id, copyValues) : addCopy(movie.id, { ...copyValues, origin: 'pipeline' });
  const copy = result.copy!;

  let file = null;
  if (relPath && req.file) {
    const values = {
      movieId: movie.id,
      copyId: copy.id,
      width: req.file.width ?? null,
      height: req.file.height ?? null,
      hdr: req.file.hdr ?? null,
      dvProfile: req.file.dv_profile ?? null,
      codec: req.file.codec ?? null,
      sizeBytes: req.file.size_bytes ?? null,
      parts: req.file.parts ?? 1,
      edition,
      missing: false,
      lastSeenAt: new Date(),
    };
    file = existingFile
      ? db.update(files).set(values).where(eq(files.id, existingFile.id)).returning().get()
      : db
          .insert(files)
          .values({ ...values, relPath, source: 'pipeline' })
          .returning()
          .get();
  }

  return {
    movie: { id: movie.id, tmdb_id: movie.tmdbId, title: movie.title, year: movie.year, created: movieCreated },
    copy: { id: copy.id, format: copy.format, ownership: copy.ownership, edition: copy.edition, created: !target },
    file: file ? { id: file.id, rel_path: file.relPath } : null,
    fulfilled_wishlist: result.fulfilled.map((w) => ({ id: w.id, target_format: w.targetFormat, kind: w.kind })),
  };
}

