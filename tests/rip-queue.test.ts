import { describe, expect, it } from 'vitest';
import { awaitingRip, discForNewFile, mapLimit, parseBulkLine } from '../src/lib/rip-queue';

const disc = (id: number, format: 'dvd' | 'bluray' | 'uhd' | 'digital', extra: Record<string, unknown> = {}) => ({
  id,
  format,
  ownership: 'owned' as const,
  reviewStatus: 'confirmed' as const,
  edition: null as string | null,
  ...extra,
});

describe('awaitingRip', () => {
  it('lists an owned, confirmed disc with no file', () => {
    expect(awaitingRip(disc(1, 'uhd'), false)).toBe(true);
    expect(awaitingRip(disc(1, 'uhd'), true)).toBe(false);
  });

  it('skips digital purchases, pirated copies and unreviewed suggestions', () => {
    expect(awaitingRip(disc(1, 'digital'), false)).toBe(false);
    expect(awaitingRip(disc(1, 'bluray', { ownership: 'pirated' }), false)).toBe(false);
    expect(awaitingRip(disc(1, 'bluray', { reviewStatus: 'needs_review' }), false)).toBe(false);
  });
});

describe('discForNewFile', () => {
  const owned = { edition: null, ownership: 'owned' as const };

  it('attaches a rip to the disc you added by hand', () => {
    expect(discForNewFile([disc(1, 'bluray')], new Set(), { ...owned, format: 'bluray' })?.id).toBe(1);
  });

  it('accepts a downscaled encode of a UHD, never an upscale of a DVD', () => {
    expect(discForNewFile([disc(1, 'uhd')], new Set(), { ...owned, format: 'bluray' })?.id).toBe(1);
    expect(discForNewFile([disc(1, 'dvd')], new Set(), { ...owned, format: 'bluray' })).toBeNull();
  });

  it('prefers the disc whose format matches', () => {
    const copies = [disc(1, 'uhd'), disc(2, 'bluray')];
    expect(discForNewFile(copies, new Set(), { ...owned, format: 'bluray' })?.id).toBe(2);
    expect(discForNewFile(copies, new Set([2]), { ...owned, format: 'bluray' })?.id).toBe(1);
  });

  it('leaves downloads and other editions alone', () => {
    expect(discForNewFile([disc(1, 'uhd')], new Set(), { edition: null, ownership: 'pirated', format: 'uhd' })).toBeNull();
    expect(discForNewFile([disc(1, 'bluray')], new Set(), { edition: null, ownership: 'unverified', format: 'digital' })).toBeNull();
    expect(discForNewFile([disc(1, 'bluray', { edition: 'Extended' })], new Set(), { ...owned, format: 'bluray' })).toBeNull();
    expect(discForNewFile([disc(1, 'bluray', { edition: 'Extended' })], new Set(), { ...owned, edition: 'extended', format: 'bluray' })?.id).toBe(1);
  });

  it('never re-attaches to a disc that already has its file', () => {
    expect(discForNewFile([disc(1, 'bluray')], new Set([1]), { ...owned, format: 'bluray' })).toBeNull();
  });
});

describe('parseBulkLine', () => {
  const parse = (s: string) => parseBulkLine(s, 2026);

  it('reads title, year and format in the usual shapes', () => {
    expect(parse('Heat (1995) uhd')).toMatchObject({ title: 'Heat', year: 1995, format: 'uhd', yearGuessed: false });
    expect(parse('Heat 1995 Blu-ray')).toMatchObject({ title: 'Heat', year: 1995, format: 'bluray', yearGuessed: true });
    expect(parse('Heat\t1995\tDVD')).toMatchObject({ title: 'Heat', year: 1995, format: 'dvd' });
    expect(parse('Heat, 4K UHD, 1995')).toMatchObject({ title: 'Heat', year: 1995, format: 'uhd' });
    expect(parse('The Thing')).toMatchObject({ title: 'The Thing', year: null, format: null });
  });

  it('keeps numbers that are part of the title', () => {
    expect(parse('Blade Runner 2049')).toMatchObject({ title: 'Blade Runner 2049', year: null });
    expect(parse('1917')).toMatchObject({ title: '1917', year: null });
    expect(parse('1917 (2019) uhd')).toMatchObject({ title: '1917', year: 2019, format: 'uhd' });
    expect(parse('Crazy, Stupid, Love. dvd')).toMatchObject({ title: 'Crazy, Stupid, Love.', format: 'dvd' });
    // A bare trailing year is only a guess: the matcher retries with the full line.
    expect(parse('Death Race 2000')).toMatchObject({ title: 'Death Race', year: 2000, yearGuessed: true });
    // "DVD" alone is a title, not a format
    expect(parse('dvd')).toMatchObject({ title: 'dvd', format: null });
  });

  it('takes a TMDB link or tag as the id', () => {
    expect(parse('https://www.themoviedb.org/movie/949-heat uhd')).toMatchObject({ tmdbId: 949, format: 'uhd' });
    expect(parse('Heat {tmdb-949}')).toMatchObject({ tmdbId: 949 });
  });

  it('skips blank lines and comments', () => {
    expect(parse('   ')).toBeNull();
    expect(parse('# shelf 2')).toBeNull();
  });
});

describe('mapLimit', () => {
  it('keeps order and caps concurrency', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });
});
