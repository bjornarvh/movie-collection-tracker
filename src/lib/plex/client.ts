import { config } from '../config';

export type PlexSection = { key: string; type: string; title: string; Location?: { path: string }[] };

export type PlexStream = {
  streamType: number;
  codec?: string;
  colorTrc?: string;
  DOVIPresent?: boolean;
  DOVIProfile?: number;
};

export type PlexPart = { id: number; file: string; size?: number; Stream?: PlexStream[] };

export type PlexMedia = {
  id: number;
  width?: number;
  height?: number;
  videoResolution?: string;
  videoCodec?: string;
  container?: string;
  Part: PlexPart[];
};

export type PlexMovie = {
  ratingKey: string;
  title: string;
  year?: number;
  updatedAt?: number;
  editionTitle?: string;
  Guid?: { id: string }[];
  Media?: PlexMedia[];
};

export class PlexError extends Error {}

export const plexConfigured = () => Boolean(config.plexUrl && config.plexToken);

async function get<T>(pathname: string): Promise<T> {
  if (!plexConfigured()) throw new PlexError('PLEX_URL / PLEX_TOKEN are not configured');
  const res = await fetch(config.plexUrl + pathname, {
    headers: { Accept: 'application/json', 'X-Plex-Token': config.plexToken },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401) throw new PlexError('Plex rejected the token (401)');
  if (!res.ok) throw new PlexError(`Plex ${pathname} failed: ${res.status}`);
  return ((await res.json()) as { MediaContainer: T }).MediaContainer;
}

export async function getIdentity() {
  return get<{ machineIdentifier: string; version: string }>('/identity');
}

export async function getMovieSections() {
  const mc = await get<{ Directory?: PlexSection[] }>('/library/sections');
  return (mc.Directory ?? []).filter((d) => d.type === 'movie');
}

export async function getSectionMovies(sectionKey: string) {
  const mc = await get<{ Metadata?: PlexMovie[] }>(`/library/sections/${encodeURIComponent(sectionKey)}/all?type=1&includeGuids=1`);
  return mc.Metadata ?? [];
}

/** Full metadata for one item, including per-part streams (needed for HDR / Dolby Vision). */
export async function getMovieDetails(ratingKey: string) {
  const mc = await get<{ Metadata?: PlexMovie[] }>(`/library/metadata/${encodeURIComponent(ratingKey)}`);
  return mc.Metadata?.[0] ?? null;
}

// The watchlist lives on plex.tv, not the local server, and belongs to the account behind PLEX_TOKEN.
const DISCOVER = 'https://discover.provider.plex.tv';

async function discover<T>(pathname: string, method: 'GET' | 'PUT' = 'GET'): Promise<T | null> {
  if (!config.plexToken) throw new PlexError('PLEX_TOKEN is not configured');
  const res = await fetch(DISCOVER + pathname, {
    method,
    headers: { Accept: 'application/json', 'X-Plex-Token': config.plexToken, 'X-Plex-Client-Identifier': 'movie-collection-tracker' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) throw new PlexError('plex.tv rejected the token (401)');
  if (!res.ok) throw new PlexError(`plex.tv ${pathname.split('?')[0]} failed: ${res.status}`);
  return method === 'GET' ? ((await res.json()) as { MediaContainer: T }).MediaContainer : null;
}

// tmdbId -> plex.tv ratingKey. The mapping never changes, so it is safe to keep for the process lifetime.
const ratingKeys = new Map<number, string | null>();

async function plexRatingKey(tmdbId: number) {
  if (!ratingKeys.has(tmdbId)) {
    const mc = await discover<{ Metadata?: { ratingKey: string }[] }>(
      `/library/metadata/matches?type=1&guid=${encodeURIComponent(`tmdb://${tmdbId}`)}`,
    );
    ratingKeys.set(tmdbId, mc?.Metadata?.[0]?.ratingKey ?? null);
  }
  return ratingKeys.get(tmdbId)!;
}

/** Whether the movie is on the Plex watchlist; `found: false` when plex.tv doesn't know the TMDB id. */
export async function getWatchlistState(tmdbId: number) {
  const ratingKey = await plexRatingKey(tmdbId);
  if (!ratingKey) return { found: false as const };
  const mc = await discover<{ UserState?: { watchlistedAt?: number }[] }>(`/library/metadata/${ratingKey}/userState`);
  return { found: true as const, watchlisted: Boolean(mc?.UserState?.[0]?.watchlistedAt) };
}

/** TMDB ids of every movie on the Plex watchlist, for pages that list many movies at once. */
export async function getWatchlistTmdbIds() {
  const ids = new Set<number>();
  const size = 100;
  for (let start = 0; ; start += size) {
    const mc = await discover<{ totalSize?: number; Metadata?: (PlexMovie & { type: string })[] }>(
      `/library/sections/watchlist/all?includeGuids=1&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`,
    );
    for (const m of mc?.Metadata ?? []) {
      // TMDB numbers movies and shows separately, so a show's id could collide with a movie's.
      const tmdbId = m.type === 'movie' ? tmdbIdFromGuids(m.Guid) : null;
      if (tmdbId) {
        ids.add(tmdbId);
        ratingKeys.set(tmdbId, m.ratingKey);
      }
    }
    if (start + size >= (mc?.totalSize ?? 0)) return ids;
  }
}

export async function setWatchlisted(tmdbId: number, on: boolean) {
  const ratingKey = await plexRatingKey(tmdbId);
  if (!ratingKey) throw new PlexError('Plex has no match for this TMDB id.');
  await discover(`/actions/${on ? 'addToWatchlist' : 'removeFromWatchlist'}?ratingKey=${ratingKey}`, 'PUT');
}

export function tmdbIdFromGuids(guids: { id: string }[] | undefined) {
  const g = guids?.find((x) => x.id.startsWith('tmdb://'));
  const n = g ? Number(g.id.slice('tmdb://'.length)) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function hdrFromStreams(streams: PlexStream[] | undefined): { hdr: 'none' | 'hdr10' | 'dv'; dvProfile: number | null } {
  const video = streams?.find((s) => s.streamType === 1);
  if (!video) return { hdr: 'none', dvProfile: null };
  if (video.DOVIPresent) return { hdr: 'dv', dvProfile: video.DOVIProfile ?? null };
  if (video.colorTrc === 'smpte2084' || video.colorTrc === 'arib-std-b67') return { hdr: 'hdr10', dvProfile: null };
  return { hdr: 'none', dvProfile: null };
}
