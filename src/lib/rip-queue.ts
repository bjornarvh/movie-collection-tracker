import type { Copy, Format, Ownership } from '../db/schema';
import { editionKey, FORMAT_RANK } from './formats';

/** Pure rules for the "to rip" list; no db import, so vitest can load it. */

/** Physical media. A digital purchase has nothing to rip. */
export const isDisc = (format: Format) => format !== 'digital';

type CopyLike = Pick<Copy, 'id' | 'format' | 'ownership' | 'reviewStatus' | 'edition'>;

/**
 * A disc you own that has no file in the library yet. Decided per copy, not per movie:
 * a UHD you bought of a film whose library file is a download is still waiting to be ripped.
 */
export const awaitingRip = (copy: Omit<CopyLike, 'id' | 'edition'>, hasFile: boolean) =>
  copy.ownership === 'owned' && copy.reviewStatus === 'confirmed' && isDisc(copy.format) && !hasFile;

/**
 * Which of your unripped discs a file the Plex scan just found is the rip of, if any.
 *
 * Without this every new Plex file gets a copy of its own, so a disc you added by hand
 * would sit on the "to rip" list forever next to a duplicate waiting in review. A file is
 * only attached when it plausibly came off that disc: same edition, not named like a
 * download, and no better than the disc (an encode may be downscaled, never upscaled).
 */
export function discForNewFile(
  copies: CopyLike[],
  linkedCopyIds: Set<number>,
  file: { edition: string | null; format: Format; ownership: Ownership },
): CopyLike | null {
  if (file.ownership === 'pirated' || file.format === 'digital') return null;
  const open = copies.filter(
    (c) =>
      awaitingRip(c, linkedCopyIds.has(c.id)) &&
      editionKey(c.edition) === editionKey(file.edition) &&
      FORMAT_RANK[file.format] <= FORMAT_RANK[c.format],
  );
  // The disc whose format matches the file, else the best one it could have come from.
  return open.find((c) => c.format === file.format) ?? open.sort((a, b) => FORMAT_RANK[b.format] - FORMAT_RANK[a.format])[0] ?? null;
}

// ---- bulk paste ------------------------------------------------------------

export type BulkLine = {
  raw: string;
  title: string;
  year: number | null;
  /** True when the year was a bare trailing number ("Death Race 2000"), which may be part of the title. */
  yearGuessed: boolean;
  format: Format | null;
  tmdbId: number | null;
};

const FORMAT_WORDS: [RegExp, Format][] = [
  [/^(?:4k(?:[\s-]*uhd)?|uhd|ultra[\s-]*hd|2160p)$/i, 'uhd'],
  [/^(?:blu[\s-]*ray|bd|bluray|1080p)$/i, 'bluray'],
  [/^dvd$/i, 'dvd'],
];
const SEP = String.raw`[\s,;|\t]+`;
const TRAILING_FORMAT = new RegExp(`(?:${SEP}|^)(4k[\\s-]*uhd|4k|uhd|ultra[\\s-]*hd|2160p|blu[\\s-]*ray|bluray|bd|1080p|dvd)\\s*$`, 'i');
const TRAILING_PAREN_YEAR = /\s*[([](\d{4})[)\]]\s*$/;
const TRAILING_BARE_YEAR = new RegExp(`${SEP}(\\d{4})\\s*$`);
const TMDB_REF = /themoviedb\.org\/movie\/(\d+)|\{?tmdb[-:](\d+)\}?/i;

const formatWord = (word: string) => FORMAT_WORDS.find(([re]) => re.test(word.trim()))?.[1] ?? null;
const plausibleYear = (y: number, now: number) => y >= 1880 && y <= now + 1;

/**
 * One line of a pasted list: "Heat (1995) uhd", "Heat 1995 Blu-ray", "Heat\t1995\tDVD",
 * a TMDB link, or just a title. Returns null for blank lines and # comments.
 */
export function parseBulkLine(raw: string, now = new Date().getFullYear()): BulkLine | null {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;

  let rest = line;
  let format: Format | null = null;
  let year: number | null = null;
  let yearGuessed = false;

  // Year and format may come in either order, so peel trailing tokens until nothing changes.
  for (let i = 0; i < 3; i++) {
    const before = rest;
    const f: RegExpMatchArray | null = format === null ? rest.match(TRAILING_FORMAT) : null;
    if (f && rest.slice(0, f.index).trim()) {
      format = formatWord(f[1]);
      rest = rest.slice(0, f.index);
    }
    const p: RegExpMatchArray | null = year === null ? rest.match(TRAILING_PAREN_YEAR) : null;
    if (p && plausibleYear(Number(p[1]), now) && rest.slice(0, p.index).trim()) {
      year = Number(p[1]);
      rest = rest.slice(0, p.index);
    }
    const b: RegExpMatchArray | null = year === null ? rest.match(TRAILING_BARE_YEAR) : null;
    if (b && plausibleYear(Number(b[1]), now) && rest.slice(0, b.index).trim()) {
      year = Number(b[1]);
      yearGuessed = true;
      rest = rest.slice(0, b.index);
    }
    rest = rest.replace(/[\s,;|\t-]+$/, '');
    if (rest === before) break;
  }

  const ref = line.match(TMDB_REF);
  return {
    raw: line,
    title: ref ? '' : rest.trim(),
    year,
    yearGuessed,
    format,
    tmdbId: ref ? Number(ref[1] ?? ref[2]) : null,
  };
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
