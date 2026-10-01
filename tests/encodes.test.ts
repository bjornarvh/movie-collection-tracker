import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  jobEta,
  jobUpdateSchema,
  runPercent,
  runState,
  runUpdateSchema,
  STALL_AFTER_MS,
  startRunSchema,
} from '../src/lib/encode-progress';

describe('runState', () => {
  const now = new Date('2026-10-01T03:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('keeps a running batch that reported recently', () => {
    expect(runState({ status: 'running', lastSeenAt: ago(60_000) }, now)).toBe('running');
    expect(runState({ status: 'running', lastSeenAt: ago(STALL_AFTER_MS) }, now)).toBe('running');
  });

  it('calls a quiet running batch stalled', () => {
    expect(runState({ status: 'running', lastSeenAt: ago(STALL_AFTER_MS + 1000) }, now)).toBe('stalled');
  });

  it('never calls a closed batch stalled', () => {
    expect(runState({ status: 'finished', lastSeenAt: ago(86_400_000) }, now)).toBe('finished');
    expect(runState({ status: 'aborted', lastSeenAt: ago(86_400_000) }, now)).toBe('aborted');
  });
});

describe('jobEta', () => {
  it('divides the remaining runtime by the encode speed', () => {
    expect(jobEta({ durationS: 3600, outTimeS: 1800, speed: 2 })).toBe(900);
  });

  it('is unknown before ffmpeg reports a speed or without a runtime', () => {
    expect(jobEta({ durationS: 3600, outTimeS: 0, speed: 0 })).toBeNull();
    expect(jobEta({ durationS: null, outTimeS: 100, speed: 1 })).toBeNull();
    expect(jobEta({ durationS: 3600, outTimeS: null, speed: 1 })).toBeNull();
  });

  it('never goes negative when the last frame runs past the probed duration', () => {
    expect(jobEta({ durationS: 100, outTimeS: 101, speed: 1 })).toBe(0);
  });
});

describe('runPercent', () => {
  it('weights jobs by runtime', () => {
    // a 1 h episode done and a 3 h film half done: (1 + 1.5) / 4
    const jobs = [
      { status: 'done' as const, percent: 100, durationS: 3600 },
      { status: 'running' as const, percent: 50, durationS: 3 * 3600 },
    ];
    expect(runPercent(jobs)).toBeCloseTo(62.5);
  });

  it('counts skipped and failed jobs as finished with', () => {
    const jobs = [
      { status: 'skipped' as const, percent: null, durationS: null },
      { status: 'failed' as const, percent: 12, durationS: 100 },
      { status: 'queued' as const, percent: null, durationS: 100 },
    ];
    expect(runPercent(jobs)).toBeCloseTo((200 / 3));
  });

  it('gives jobs not yet probed the average known runtime', () => {
    const jobs = [
      { status: 'done' as const, percent: 100, durationS: 1000 },
      { status: 'queued' as const, percent: null, durationS: null },
    ];
    expect(runPercent(jobs)).toBeCloseTo(50);
  });

  it('falls back to counting jobs when no runtime is known', () => {
    const jobs = [
      { status: 'running' as const, percent: 50, durationS: null },
      { status: 'queued' as const, percent: null, durationS: null },
    ];
    expect(runPercent(jobs)).toBeCloseTo(25);
    expect(runPercent([])).toBe(0);
  });
});

describe('schemas', () => {
  it('accepts the batch-start payload media-pipeline sends', () => {
    const parsed = startRunSchema.parse({
      host: 'DESKTOP',
      input_root: 'D:\\Video\\in',
      output_root: 'M:\\Movies',
      encoder: 'nvenc',
      options: { film: false, crf: null, max_height: null, dv: 'skip' },
      jobs: [{ rel_path: 'Movies/Ben-Hur (1959) {tmdb-665}/Ben-Hur (1959).mkv', parts: 2 }, { rel_path: 'Movies/Heat (1995) {tmdb-949}/Heat (1995).mkv' }],
    });
    expect(parsed.jobs[1].parts).toBe(1);
  });

  it('rejects a progress report outside 0–100', () => {
    expect(jobUpdateSchema.safeParse({ percent: 101 }).success).toBe(false);
    expect(jobUpdateSchema.safeParse({ status: 'paused' }).success).toBe(false);
  });

  it('treats an empty run update as a heartbeat, but cannot reopen a run', () => {
    expect(runUpdateSchema.parse({})).toEqual({});
    expect(runUpdateSchema.safeParse({ status: 'running' }).success).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3 * 3600 + 5 * 60 + 9)).toBe('3h 05m');
    expect(formatDuration(65)).toBe('1m 05s');
    expect(formatDuration(9.4)).toBe('9s');
    expect(formatDuration(null)).toBe('');
  });
});
