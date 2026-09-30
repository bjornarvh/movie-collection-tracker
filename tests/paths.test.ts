import { describe, expect, it } from 'vitest';
import { normalizeRelPath, parsePlexNaming } from '../src/lib/paths';

const prefixes = ['/media/', '/mnt/user/media/', '/data/', 'M:/'];

describe('normalizeRelPath', () => {
  const expected = 'Movies/Casino Royale (2006) {tmdb-36557}/Casino Royale (2006).576p.hevc.mkv';

  it('handles Plex container paths', () => {
    expect(normalizeRelPath('/media/Movies/Casino Royale (2006) {tmdb-36557}/Casino Royale (2006).576p.hevc.mkv', prefixes)).toBe(expected);
  });

  it('handles Windows drive paths', () => {
    expect(normalizeRelPath('M:\\Movies\\Casino Royale (2006) {tmdb-36557}\\Casino Royale (2006).576p.hevc.mkv', prefixes)).toBe(expected);
    expect(normalizeRelPath('m:\\Movies\\Casino Royale (2006) {tmdb-36557}\\Casino Royale (2006).576p.hevc.mkv', prefixes)).toBe(expected);
  });

  it('handles Unraid host paths and already-relative paths', () => {
    expect(normalizeRelPath('/mnt/user/media/Movies/Casino Royale (2006) {tmdb-36557}/Casino Royale (2006).576p.hevc.mkv', prefixes)).toBe(expected);
    expect(normalizeRelPath(expected, prefixes)).toBe(expected);
  });

  it('strips an unknown drive letter', () => {
    expect(normalizeRelPath('Z:\\Movies\\X\\y.mkv', prefixes)).toBe('Movies/X/y.mkv');
  });
});

describe('parsePlexNaming', () => {
  it('reads tmdb id and edition from folder or file', () => {
    expect(parsePlexNaming('Movies/Independence Day (1996) {tmdb-602} {edition-Extended Cut}/Independence Day (1996).4k.REMUX {edition-Extended Cut}.mkv')).toEqual({
      tmdbId: 602,
      edition: 'Extended Cut',
    });
    expect(parsePlexNaming('Movies/Battle Royale (2000) {tmdb-3176}/Battle Royale (2000) {edition-Special Edition}.mkv')).toEqual({
      tmdbId: 3176,
      edition: 'Special Edition',
    });
    expect(parsePlexNaming('Movies/Heat (1995)/Heat (1995).mkv')).toEqual({ tmdbId: null, edition: null });
  });
});
