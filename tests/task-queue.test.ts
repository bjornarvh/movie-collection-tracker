import { describe, expect, it } from 'vitest';
import {
  appendLog,
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
