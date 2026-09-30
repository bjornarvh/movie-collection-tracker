import { config } from './config';

const API = 'https://api.themoviedb.org/3';

export type TmdbSearchResult = {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  overview?: string;
  poster_path: string | null;
};

export type TmdbMovie = TmdbSearchResult & {
  imdb_id: string | null;
  runtime: number | null;
  backdrop_path: string | null;
  genres: { id: number; name: string }[];
};

export class TmdbError extends Error {}

export const tmdbConfigured = () => Boolean(config.tmdbApiKey);

/**
 * Minimal TMDB client. Accepts either a v4 read access token (a JWT, starts with "eyJ")
 * or a v3 API key, same as media-pipeline's nfo.py, and retries on 429 using Retry-After.
 */
async function get<T>(pathname: string, params: Record<string, string> = {}): Promise<T | null> {
  if (!config.tmdbApiKey) throw new TmdbError('TMDB_API_KEY is not configured');
  const url = new URL(API + pathname);
  url.searchParams.set('language', config.tmdbLanguage);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.tmdbApiKey.startsWith('eyJ')) headers.Authorization = `Bearer ${config.tmdbApiKey}`;
  else url.searchParams.set('api_key', config.tmdbApiKey);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await new Promise((r) => setTimeout(r, Math.min(wait, 10) * 1000));
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new TmdbError(`TMDB rejected the API key (${res.status})`);
    if (!res.ok) throw new TmdbError(`TMDB ${pathname} failed: ${res.status}`);
    return (await res.json()) as T;
  }
  throw new TmdbError(`TMDB ${pathname}: still rate limited after retries`);
}

export async function searchMovies(query: string, year?: number) {
  const params: Record<string, string> = { query, include_adult: 'false' };
  if (year) params.year = String(year);
  const data = await get<{ results: TmdbSearchResult[] }>('/search/movie', params);
  return data?.results ?? [];
}

export const getMovie = (id: number) => get<TmdbMovie>(`/movie/${id}`);

export const releaseYear = (m: { release_date?: string }) => (m.release_date ? Number(m.release_date.slice(0, 4)) || null : null);
