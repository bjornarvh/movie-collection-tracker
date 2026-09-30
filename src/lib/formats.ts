import type { Copy, Format, Ownership } from '../db/schema';

export const FORMAT_RANK: Record<Format, number> = { dvd: 1, digital: 2, bluray: 3, uhd: 4 };

export const FORMAT_LABEL: Record<Format, string> = {
  dvd: 'DVD',
  digital: 'Digital',
  bluray: 'Blu-ray',
  uhd: '4K UHD',
};

export const OWNERSHIP_LABEL: Record<Ownership, string> = {
  owned: 'Owned',
  pirated: 'Pirated',
  unverified: 'Unverified',
};

export const TARGET_LABEL: Record<'bluray' | 'uhd', string> = {
  bluray: 'Blu-ray is enough',
  uhd: '4K only',
};

export const satisfies = (format: Format, target: Format) => FORMAT_RANK[format] >= FORMAT_RANK[target];

/** Highest-ranked format among copies matching `filter`, or null when there are none. */
export function bestFormat(copies: Pick<Copy, 'format' | 'ownership'>[], filter: (c: Pick<Copy, 'ownership'>) => boolean = () => true) {
  let best: Format | null = null;
  for (const c of copies) {
    if (filter(c) && (best === null || FORMAT_RANK[c.format] > FORMAT_RANK[best])) best = c.format;
  }
  return best;
}

export const bestOwned = (copies: Pick<Copy, 'format' | 'ownership'>[]) => bestFormat(copies, (c) => c.ownership === 'owned');

/** Normalise an edition label so "Director's Cut" from a folder and a filename compare equal. */
export const editionKey = (edition: string | null | undefined) => (edition ?? '').trim().toLowerCase();

export const posterUrl = (p: string | null | undefined, size: 'w185' | 'w342' | 'w500' | 'w780' = 'w342') =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : null;

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function resolutionLabel(width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height) return '';
  if (width >= 3000 || height >= 1600) return '2160p';
  if (width >= 1200 || height > 800) return '1080p';
  if (width >= 1000 || height >= 700) return '720p';
  return `${height}p`;
}
