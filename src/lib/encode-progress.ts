import { z } from 'zod';
import { ENCODE_JOB_STATUSES, type EncodeJob, type EncodeRun } from '../db/schema';

/** Pure logic for the media-pipeline encode tracker; the database side is in encodes.ts. */

export const startRunSchema = z.object({
  host: z.string().trim().min(1).max(200),
  input_root: z.string().max(1000).nullish(),
  output_root: z.string().max(1000).nullish(),
  encoder: z.string().max(50).nullish(),
  options: z.record(z.string(), z.unknown()).nullish(),
  jobs: z
    .array(
      z.object({
        /** Output path, library-relative or absolute; normalised like ingest paths. */
        rel_path: z.string().min(1).max(1000),
        parts: z.number().int().positive().default(1),
        duration_s: z.number().nonnegative().nullish(),
      }),
    )
    .max(5000),
});

export const jobUpdateSchema = z.object({
  status: z.enum(ENCODE_JOB_STATUSES).optional(),
  stage: z.string().max(100).nullish(),
  percent: z.number().min(0).max(100).nullish(),
  speed: z.number().nonnegative().nullish(),
  fps: z.number().nonnegative().nullish(),
  out_time_s: z.number().nonnegative().nullish(),
  duration_s: z.number().nonnegative().nullish(),
  description: z.string().max(500).nullish(),
  error: z.string().max(2000).nullish(),
  size_bytes: z.number().int().nonnegative().nullish(),
  gb_per_hour: z.number().nonnegative().nullish(),
});

/** An empty body is a heartbeat: it only proves the batch is still alive. */
export const runUpdateSchema = z.object({
  status: z.enum(['finished', 'aborted']).optional(),
  done: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
});

export type StartRunRequest = z.infer<typeof startRunSchema>;
export type JobUpdate = z.infer<typeof jobUpdateSchema>;
export type RunUpdate = z.infer<typeof runUpdateSchema>;

/**
 * A batch that was killed (Ctrl+C, reboot, power cut) never reports "finished".
 * The pipeline reports at least once a minute while it runs, so ten quiet minutes
 * means it is gone.
 */
export const STALL_AFTER_MS = 10 * 60 * 1000;

export type RunState = 'running' | 'stalled' | 'finished' | 'aborted';

export function runState(run: Pick<EncodeRun, 'status' | 'lastSeenAt'>, now = new Date()): RunState {
  if (run.status !== 'running') return run.status;
  return now.getTime() - run.lastSeenAt.getTime() > STALL_AFTER_MS ? 'stalled' : 'running';
}

/**
 * Which runs get a live card on /encodes: every batch still marked running
 * (the desktop and the server can encode at the same time, and a quiet one
 * shows as stalled), or, when none is, the newest batch as "Last batch".
 * `runs` is newest first.
 */
export function currentRuns<R extends Pick<EncodeRun, 'status'>>(runs: R[]): R[] {
  const running = runs.filter((r) => r.status === 'running');
  return running.length ? running : runs.slice(0, 1);
}

export const isTerminal = (status: EncodeJob['status']) => status === 'done' || status === 'skipped' || status === 'failed';

/** Seconds left on a running job, from ffmpeg's position and speed; null when unknown. */
export function jobEta(job: Pick<EncodeJob, 'durationS' | 'outTimeS' | 'speed'>): number | null {
  if (!job.durationS || job.outTimeS == null || !job.speed) return null;
  return Math.max(0, (job.durationS - job.outTimeS) / job.speed);
}

/**
 * Overall progress of a batch, 0–100, weighted by runtime. A job's runtime is only
 * known once it starts (probing a whole season up front would delay the first
 * encode), so jobs without one weigh the average of those that have one.
 */
export function runPercent(jobs: Pick<EncodeJob, 'status' | 'percent' | 'durationS'>[]): number {
  if (jobs.length === 0) return 0;
  const known = jobs.map((j) => j.durationS).filter((d): d is number => d != null && d > 0);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  let total = 0;
  let complete = 0;
  for (const j of jobs) {
    const weight = j.durationS && j.durationS > 0 ? j.durationS : fallback;
    total += weight;
    if (isTerminal(j.status)) complete += weight;
    else if (j.status === 'running') complete += (weight * (j.percent ?? 0)) / 100;
  }
  return (complete / total) * 100;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}
