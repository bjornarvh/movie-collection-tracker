/**
 * Turn an absolute path from Plex (/media/Movies/...), media-pipeline (M:\Movies\...)
 * or an already-relative path into the canonical library-relative form with forward
 * slashes, so the same file reported by different sources matches on `rel_path`.
 */
export function normalizeRelPath(input: string, prefixes: string[]): string {
  let p = input.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const lower = p.toLowerCase();
  const match = prefixes
    .map((pre) => pre.replace(/\\/g, '/'))
    .map((pre) => (pre.endsWith('/') ? pre : `${pre}/`))
    .filter((pre) => lower.startsWith(pre.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (match) p = p.slice(match.length);
  else p = p.replace(/^[A-Za-z]:\//, '');
  return p.replace(/^\/+/, '');
}

export const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const stripExt = (name: string) => name.replace(/\.[A-Za-z0-9]{2,4}$/, '');

const TMDB_TAG = /\{tmdb-(\d+)\}/i;
const EDITION_TAG = /\{edition-([^}]+)\}/i;

/** Pull `{tmdb-N}` and `{edition-X}` out of a Plex-style path (checks file name first, then folder). */
export function parsePlexNaming(relPath: string) {
  const file = baseName(relPath);
  const folder = baseName(dirName(relPath));
  const tmdb = file.match(TMDB_TAG) ?? folder.match(TMDB_TAG);
  const edition = file.match(EDITION_TAG) ?? folder.match(EDITION_TAG);
  return {
    tmdbId: tmdb ? Number(tmdb[1]) : null,
    edition: edition ? edition[1].trim() : null,
  };
}
