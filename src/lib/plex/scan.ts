import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { files, scanRuns, type ScanStats } from '../../db/schema';
import { classify } from '../classify';
import { addCopy, ensureMovie, movieCopies } from '../collection';
import { config } from '../config';
import { FORMAT_LABEL } from '../formats';
import { discForNewFile } from '../rip-queue';
import { baseName, dirName, normalizeRelPath, parsePlexNaming } from '../paths';
import {
  getMovieDetails,
  getMovieSections,
  getSectionMovies,
  hdrFromStreams,
  tmdbIdFromGuids,
  type PlexMedia,
  type PlexMovie,
} from './client';

let running: Promise<number> | null = null;

export const scanInProgress = () => running !== null;

/** Starts a Plex scan unless one is already running. Resolves with the scan_runs id. */
export function startScan(trigger: 'manual' | 'schedule') {
  running ??= runScan(trigger).finally(() => {
    running = null;
  });
  return running;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** Reads folder listing and a sibling .nfo from the media mount, when it is available. */
async function folderHints(relPath: string) {
  if (!config.mediaRoot) return { siblings: [] as string[], nfoText: null };
  const dir = path.join(config.mediaRoot, dirName(relPath));
  try {
    const siblings = await readdir(dir);
    const stem = baseName(relPath).replace(/\.[^.]+$/, '');
    const nfos = siblings.filter((s) => s.toLowerCase().endsWith('.nfo'));
    const nfo = nfos.find((s) => s.startsWith(stem)) ?? (nfos.length === 1 ? nfos[0] : undefined);
    const nfoText = nfo ? (await readFile(path.join(dir, nfo), 'latin1')).slice(0, 8192) : null;
    return { siblings, nfoText };
  } catch {
    return { siblings: [], nfoText: null };
  }
}

async function runScan(trigger: 'manual' | 'schedule'): Promise<number> {
  const run = db.insert(scanRuns).values({ trigger, status: 'running' }).returning().get();
  const startedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const log: string[] = [];
  const stats: ScanStats = { sections: [], items: 0, newMovies: 0, newFiles: 0, updatedFiles: 0, missingFiles: 0, skipped: 0, errors: 0 };
  const note = (line: string) => {
    if (log.length < 500) log.push(line);
  };

  try {
    const all = await getMovieSections();
    const sections = config.plexSections.length
      ? all.filter((s) => config.plexSections.some((want) => want === s.key || want.toLowerCase() === s.title.toLowerCase()))
      : all;
    if (sections.length === 0) throw new Error('No matching Plex movie sections found');

    for (const section of sections) {
      stats.sections.push(section.title);
      const items = await getSectionMovies(section.key);
      stats.items += items.length;
      note(`Section "${section.title}": ${items.length} items`);
      await pool(items, 4, async (item) => {
        try {
          await processItem(item, stats, note);
        } catch (err) {
          stats.errors++;
          note(`ERROR ${item.title} (${item.year ?? '?'}): ${(err as Error).message}`);
        }
      });
    }

    // Only flag missing files after a scan that covered everything without errors,
    // so a Plex hiccup doesn't mark the whole library as gone.
    if (stats.errors === 0 && config.plexSections.length === 0) {
      const gone = db
        .update(files)
        .set({ missing: true })
        .where(and(isNotNull(files.plexMediaId), lt(files.lastSeenAt, startedAt), eq(files.missing, false)))
        .returning({ relPath: files.relPath })
        .all();
      stats.missingFiles = gone.length;
      for (const g of gone.slice(0, 50)) note(`Missing: ${g.relPath}`);
    }

    db.update(scanRuns)
      .set({ status: 'ok', finishedAt: new Date(), stats, log: log.join('\n') })
      .where(eq(scanRuns.id, run.id))
      .run();
  } catch (err) {
    note(`FATAL: ${(err as Error).message}`);
    db.update(scanRuns)
      .set({ status: 'error', finishedAt: new Date(), stats, log: log.join('\n') })
      .where(eq(scanRuns.id, run.id))
      .run();
  }
  return run.id;
}

function mediaSummary(media: PlexMedia) {
  const parts = media.Part ?? [];
  return {
    relPath: normalizeRelPath(parts[0].file, config.pathPrefixes),
    sizeBytes: parts.reduce((sum, p) => sum + (p.size ?? 0), 0) || null,
    parts: parts.length,
    width: media.width ?? null,
    height: media.height ?? null,
    codec: media.videoCodec ?? null,
    container: media.container ?? null,
  };
}

async function processItem(item: PlexMovie, stats: ScanStats, note: (l: string) => void) {
  const medias = (item.Media ?? []).filter((m) => m.Part?.length);
  if (medias.length === 0) return;
  const firstRel = normalizeRelPath(medias[0].Part[0].file, config.pathPrefixes);
  const naming = parsePlexNaming(firstRel);
  const tmdbId = tmdbIdFromGuids(item.Guid) ?? naming.tmdbId;
  if (!tmdbId) {
    stats.skipped++;
    note(`Skipped (no TMDB id): ${firstRel}`);
    return;
  }

  // Work out which media versions are new or changed before fetching details.
  const pending = medias.map((media) => {
    const summary = mediaSummary(media);
    const existing = db
      .select()
      .from(files)
      .where(or(eq(files.plexMediaId, String(media.id)), eq(files.relPath, summary.relPath)))
      .get();
    return { media, summary, existing };
  });
  const needsDetails = pending.some((p) => !p.existing || p.existing.hdr === null || p.existing.plexUpdatedAt !== (item.updatedAt ?? null));
  const details = needsDetails ? await getMovieDetails(item.ratingKey) : null;

  let movieId: number | null = null;
  for (const { media, summary, existing } of pending) {
    const detailMedia = details?.Media?.find((m) => m.id === media.id);
    const hdr = detailMedia ? hdrFromStreams(detailMedia.Part[0]?.Stream) : null;
    const edition = item.editionTitle?.trim() || parsePlexNaming(summary.relPath).edition;
    const common = {
      ...summary,
      edition,
      plexRatingKey: item.ratingKey,
      plexMediaId: String(media.id),
      plexUpdatedAt: item.updatedAt ?? null,
      ...(hdr ? { hdr: hdr.hdr, dvProfile: hdr.dvProfile } : {}),
      missing: false,
      lastSeenAt: new Date(),
    };

    if (existing) {
      // Technical fields only; copies you have reviewed are never touched by a rescan.
      db.update(files).set(common).where(eq(files.id, existing.id)).run();
      stats.updatedFiles++;
      continue;
    }

    if (movieId === null) {
      const { movie, created } = await ensureMovie(tmdbId, { title: item.title, year: item.year });
      movieId = movie.id;
      if (created) {
        stats.newMovies++;
        if (!movie.tmdbSyncedAt) note(`TMDB lookup failed, using Plex title: ${item.title}`);
      }
    }

    const hints = await folderHints(summary.relPath);
    const c = classify({
      fileName: baseName(summary.relPath),
      width: summary.width,
      height: summary.height,
      sizeBytes: summary.sizeBytes,
      siblings: hints.siblings,
      nfoText: hints.nfoText,
    });
    // A rip of a disc you added by hand belongs to that disc. Its copy is already
    // reviewed, so only the file is linked; the copy itself is left as you set it.
    const linked = new Set(
      db
        .select({ copyId: files.copyId })
        .from(files)
        .where(and(eq(files.movieId, movieId), eq(files.missing, false)))
        .all()
        .map((f) => f.copyId)
        .filter((id): id is number => id !== null),
    );
    const disc = discForNewFile(movieCopies(movieId), linked, { edition, format: c.format, ownership: c.ownership });
    const copyId = disc
      ? disc.id
      : addCopy(movieId, {
          format: c.format,
          ownership: c.ownership,
          edition,
          origin: 'plex',
          reviewStatus: 'needs_review',
          suggestionReason: c.reasons.join('; '),
          confidence: c.confidence,
        }).copy.id;
    if (disc) note(`Linked to your ${FORMAT_LABEL[disc.format]} disc: ${summary.relPath}`);
    db.insert(files)
      .values({ ...common, movieId, copyId, source: 'plex', hdr: hdr?.hdr ?? null, dvProfile: hdr?.dvProfile ?? null })
      .run();
    stats.newFiles++;
  }
}
