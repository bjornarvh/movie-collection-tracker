import { describe, expect, it } from 'vitest';
import {
  appendLog,
  bytesPerHour,
  heldOriginals,
  matchesQuery,
  heldParams,
  reencodeParams,
  encodeParams,
  folderName,
  handoffParams,
  LOG_LIMIT,
  mayClaim,
  parseHours,
  STALL_AFTER_MS,
  taskState,
  taskTitle,
  withinHours,
  workerOnline,
} from '../src/lib/task-queue';

describe('folderName', () => {
  it('accepts a Plex movie folder', () => {
    expect(folderName.parse('Das Boot (1981) {tmdb-387}')).toBe('Das Boot (1981) {tmdb-387}');
  });

  it('refuses anything that could leave the worker root', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', '../etc', '_temp', '', 'x\u0000y']) {
      expect(folderName.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('encode params', () => {
  it('defaults to a test sample into Movies', () => {
    expect(encodeParams.parse({ folder: 'Heat (1995) {tmdb-949}' })).toEqual({
      folder: 'Heat (1995) {tmdb-949}',
      library: 'Movies',
      mode: 'test',
      film: false,
      maxHeight: null,
      quality: null,
    });
  });

  it('accepts a quality override within range', () => {
    expect(encodeParams.parse({ folder: 'x', quality: 20 }).quality).toBe(20);
    expect(encodeParams.safeParse({ folder: 'x', quality: 50 }).success).toBe(false);
    expect(encodeParams.safeParse({ folder: 'x', quality: 19.5 }).success).toBe(false);
  });

  it('rejects unknown modes and silly heights', () => {
    expect(encodeParams.safeParse({ folder: 'x', mode: 'rm -rf' }).success).toBe(false);
    expect(encodeParams.safeParse({ folder: 'x', maxHeight: -1 }).success).toBe(false);
  });

  it('carries the follow-up encode on a handoff without its own folder', () => {
    const p = handoffParams.parse({ folder: 'Heat (1995)', then: { mode: 'full', film: true } });
    expect(p.then).toEqual({ library: 'Movies', mode: 'full', film: true, maxHeight: null, quality: null });
  });
});

describe('taskTitle', () => {
  it('names the folder and a non-default mode', () => {
    expect(taskTitle('encode', { folder: 'Heat', mode: 'test' })).toBe('Encode: Heat (test)');
    expect(taskTitle('encode', { folder: 'Heat', mode: 'full' })).toBe('Encode: Heat');
    expect(taskTitle('handoff', { folder: 'Heat' })).toBe('Copy to server: Heat');
  });
});

describe('allowed hours', () => {
  it('parses windows and rejects nonsense', () => {
    expect(parseHours('22-7')).toEqual({ start: 22, end: 7 });
    expect(parseHours('9-17')).toEqual({ start: 9, end: 17 });
    expect(parseHours('25-3')).toBeNull();
    expect(parseHours('night')).toBeNull();
  });

  it('wraps an overnight window past midnight', () => {
    expect(withinHours('22-7', 23)).toBe(true);
    expect(withinHours('22-7', 3)).toBe(true);
    expect(withinHours('22-7', 7)).toBe(false);
    expect(withinHours('22-7', 12)).toBe(false);
  });

  it('handles a daytime window and "any time"', () => {
    expect(withinHours('9-17', 9)).toBe(true);
    expect(withinHours('9-17', 17)).toBe(false);
    expect(withinHours(null, 4)).toBe(true);
    expect(withinHours('0-24', 4)).toBe(true);
  });

  it('never lets a paused worker claim', () => {
    const at = (h: number) => new Date(2026, 9, 3, h, 30);
    expect(mayClaim({ paused: true, allowedHours: null }, at(12))).toBe(false);
    expect(mayClaim({ paused: false, allowedHours: '22-7' }, at(12))).toBe(false);
    expect(mayClaim({ paused: false, allowedHours: '22-7' }, at(23))).toBe(true);
  });
});

describe('liveness', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('calls a quiet running task stalled', () => {
    expect(taskState({ status: 'running', lastSeenAt: ago(60_000) }, now)).toBe('running');
    expect(taskState({ status: 'running', lastSeenAt: ago(STALL_AFTER_MS + 1) }, now)).toBe('stalled');
    expect(taskState({ status: 'done', lastSeenAt: ago(STALL_AFTER_MS * 10) }, now)).toBe('done');
  });

  it('shows a worker offline when it stops polling', () => {
    expect(workerOnline({ lastSeenAt: ago(10_000) }, now)).toBe(true);
    expect(workerOnline({ lastSeenAt: ago(10 * 60_000) }, now)).toBe(false);
    expect(workerOnline({ lastSeenAt: null }, now)).toBe(false);
  });
});

describe('appendLog', () => {
  it('appends until the cap, then keeps the tail from a line boundary', () => {
    expect(appendLog('a\n', 'b\n')).toBe('a\nb\n');
    const long = appendLog('x'.repeat(LOG_LIMIT), '\nlast line\n');
    expect(long.startsWith('[… earlier output cut]\n')).toBe(true);
    expect(long.endsWith('last line\n')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(LOG_LIMIT + 30);
  });
});

describe('re-encode params', () => {
  it('accepts a movie file and a TV season', () => {
    expect(reencodeParams.parse({ library: 'Movies', folder: 'Heat (1995) {tmdb-949}', file: 'Heat (1995).mkv' }).mode).toBe('test');
    expect(reencodeParams.parse({ library: 'TV Shows', folder: 'Shogun {tmdb-1}/Season 01' }).file).toBeNull();
  });

  it('refuses anything outside a library folder', () => {
    const bad = [
      { library: 'Music', folder: 'x' },
      { library: 'Movies', folder: '../x' },
      { library: 'Movies', folder: 'a/b/c' },
      { library: 'Movies', folder: '_replaced' },
      { library: 'Movies', folder: 'Heat', file: 'Heat.nfo' },
      { library: 'Movies', folder: 'Heat', mode: 'dry-run' },
    ];
    for (const p of bad) expect(reencodeParams.safeParse(p).success, JSON.stringify(p)).toBe(false);
  });

  it('accepts only library file paths for held originals', () => {
    expect(heldParams.safeParse({ relPath: 'Movies/Heat (1995) {tmdb-949}/Heat (1995).mkv' }).success).toBe(true);
    expect(heldParams.safeParse({ relPath: 'TV Shows/Shogun/Season 01/E1.mkv' }).success).toBe(true);
    for (const relPath of ['Movies/x.mkv', 'Movies/../a/b.mkv', 'Music/a/b.mkv', 'Movies/a/b.nfo', 'Movies/a/b/c/d.mkv']) {
      expect(heldParams.safeParse({ relPath }).success, relPath).toBe(false);
    }
  });

  it('titles the new task types', () => {
    expect(taskTitle('reencode', { folder: 'Heat', file: 'Heat.mkv', mode: 'test' })).toBe('Re-encode: Heat.mkv (test)');
    expect(taskTitle('reencode', { folder: 'Shogun/Season 01', file: null, mode: 'full' })).toBe('Re-encode: Shogun/Season 01');
    expect(taskTitle('purge-original', { relPath: 'Movies/Heat/Heat.mkv' })).toBe('Delete held original: Heat.mkv');
  });
});

describe('heldOriginals', () => {
  const at = new Date('2026-10-03T03:00:00Z');
  const heat = 'Movies/Heat/Heat.mkv';
  const row = (id: number, type: string, result: Record<string, unknown> | null, status = 'done') => ({ id, type, status, finishedAt: at, result });

  it('replays replace, restore and purge in task order', () => {
    const replace = row(1, 'reencode', {
      files: [
        { relPath: heat, status: 'replaced', oldSize: 30, newSize: 8 },
        { relPath: 'Movies/Up/Up.mkv', status: 'skipped', reason: 'already HEVC' },
      ],
    });
    expect(heldOriginals([replace])).toEqual([{ relPath: heat, kind: 'original', oldSize: 30, newSize: 8, since: at, taskId: 1 }]);
    expect(heldOriginals([row(2, 'restore-original', { relPath: heat }), replace])[0].kind).toBe('encode');
    expect(heldOriginals([replace, row(2, 'purge-original', { relPath: heat })])).toEqual([]);
  });

  it('counts files a partly failed re-encode replaced, but not failed purges', () => {
    const partly = row(1, 'reencode', { files: [{ relPath: heat, status: 'replaced', oldSize: 3, newSize: 1 }] }, 'failed');
    expect(heldOriginals([partly])).toHaveLength(1);
    expect(heldOriginals([partly, row(2, 'purge-original', { relPath: heat }, 'failed')])).toHaveLength(1);
  });
});

describe('bytesPerHour', () => {
  it('needs both size and runtime', () => {
    expect(bytesPerHour(30 * 1024 ** 3, 7200)).toBe(15 * 1024 ** 3);
    expect(bytesPerHour(null, 7200)).toBeNull();
    expect(bytesPerHour(1, null)).toBeNull();
  });
});

describe('matchesQuery', () => {
  it('matches every word in any order, ignoring case and accents', () => {
    expect(matchesQuery('Heat 1995 Movies/Heat (1995) {tmdb-949}/Heat (1995).mkv', 'heat 1995')).toBe(true);
    expect(matchesQuery('Güneşin Doğduğu Yer', 'gunesin yer')).toBe(true);
    expect(matchesQuery('Kurtlar Vadisi Pusu', 'KURTLAR')).toBe(true);
    expect(matchesQuery('Diriliş Ertuğrul', 'dirilis')).toBe(true);
    expect(matchesQuery('Heat', 'heat 1996')).toBe(false);
  });

  it('matches everything for an empty query', () => {
    expect(matchesQuery('anything', '')).toBe(true);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });
});
