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
