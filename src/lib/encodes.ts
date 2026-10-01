import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { encodeJobs, encodeRuns, type EncodeJob, type EncodeRun } from '../db/schema';
import { config } from './config';
import { isTerminal, type JobUpdate, type RunUpdate, type StartRunRequest } from './encode-progress';
import { normalizeRelPath, parsePlexNaming } from './paths';

export type RunWithJobs = EncodeRun & { jobs: EncodeJob[] };

/** A show folder's {tmdb-N} is a TV id; linking it to /movie/N would open an unrelated film. */
const EPISODE = /\b[Ss]\d{1,2}[Ee]\d{1,3}\b|(^|\/)(Season \d+|Specials)\//i;

/**
 * Register a new batch and its queue. Any earlier batch from the same host that is
 * still marked running was killed without reporting, so it is closed as aborted.
 */
export function startRun(req: StartRunRequest) {
  const now = new Date();
  return db.transaction((tx) => {
    const orphans = tx
      .select({ id: encodeRuns.id })
      .from(encodeRuns)
      .where(and(eq(encodeRuns.host, req.host), eq(encodeRuns.status, 'running')))
      .all()
      .map((r) => r.id);
    if (orphans.length) {
      tx.update(encodeRuns).set({ status: 'aborted', finishedAt: now }).where(inArray(encodeRuns.id, orphans)).run();
      tx.update(encodeJobs)
        .set({ status: 'failed', error: 'batch interrupted', finishedAt: now })
        .where(and(inArray(encodeJobs.runId, orphans), eq(encodeJobs.status, 'running')))
        .run();
    }

    const run = tx
      .insert(encodeRuns)
      .values({
        host: req.host,
        inputRoot: req.input_root ?? null,
        outputRoot: req.output_root ?? null,
        encoder: req.encoder ?? null,
        options: req.options ?? null,
        status: 'running',
        startedAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get();

    const jobIds = req.jobs.map((j, position) => {
      const relPath = normalizeRelPath(j.rel_path, config.pathPrefixes);
      return tx
        .insert(encodeJobs)
        .values({
          runId: run.id,
          position,
          relPath,
          parts: j.parts,
          tmdbId: EPISODE.test(relPath) ? null : parsePlexNaming(relPath).tmdbId,
          durationS: j.duration_s ?? null,
        })
        .returning({ id: encodeJobs.id })
        .get().id;
    });
    return { run_id: run.id, job_ids: jobIds, aborted_runs: orphans };
  });
}

const touch = (runId: number) =>
  db.update(encodeRuns).set({ lastSeenAt: new Date() }).where(eq(encodeRuns.id, runId)).run();

/** Apply a status or progress report to one job. Returns null when the job is not in that run. */
export function updateJob(runId: number, jobId: number, u: JobUpdate) {
  const job = db
    .select()
    .from(encodeJobs)
    .where(and(eq(encodeJobs.id, jobId), eq(encodeJobs.runId, runId)))
    .get();
  if (!job) return null;

  const now = new Date();
  const set: Partial<typeof encodeJobs.$inferInsert> = {};
  if (u.status !== undefined) set.status = u.status;
  if (u.stage !== undefined) set.stage = u.stage;
  if (u.percent !== undefined) set.percent = u.percent;
  if (u.speed !== undefined) set.speed = u.speed;
  if (u.fps !== undefined) set.fps = u.fps;
  if (u.out_time_s !== undefined) set.outTimeS = u.out_time_s;
  if (u.duration_s !== undefined) set.durationS = u.duration_s;
  if (u.description !== undefined) set.description = u.description;
  if (u.error !== undefined) set.error = u.error;
  if (u.size_bytes !== undefined) set.sizeBytes = u.size_bytes;
  if (u.gb_per_hour !== undefined) set.gbPerHour = u.gb_per_hour;

  if (u.status === 'running' && !job.startedAt) set.startedAt = now;
  if (u.status && isTerminal(u.status)) {
    set.finishedAt = now;
    set.stage = null;
    if (u.status === 'done') set.percent = 100;
  }

  const updated = Object.keys(set).length
    ? db.update(encodeJobs).set(set).where(eq(encodeJobs.id, jobId)).returning().get()
    : job;
  touch(runId);
  return updated;
}

/** Close a batch, or with an empty body just record that it is still alive. */
export function updateRun(runId: number, u: RunUpdate) {
  const run = db.select().from(encodeRuns).where(eq(encodeRuns.id, runId)).get();
  if (!run) return null;
  const now = new Date();
  const set: Partial<typeof encodeRuns.$inferInsert> = { lastSeenAt: now };
  if (u.done !== undefined) set.done = u.done;
  if (u.skipped !== undefined) set.skipped = u.skipped;
  if (u.failed !== undefined) set.failed = u.failed;
  if (u.status) {
    set.status = u.status;
    set.finishedAt = now;
  }
  const updated = db.update(encodeRuns).set(set).where(eq(encodeRuns.id, runId)).returning().get();
  if (u.status === 'aborted') {
    db.update(encodeJobs)
      .set({ status: 'failed', error: 'batch interrupted', finishedAt: now, stage: null })
      .where(and(eq(encodeJobs.runId, runId), eq(encodeJobs.status, 'running')))
      .run();
  }
  return updated;
}

function withJobs(runs: EncodeRun[]): RunWithJobs[] {
  if (!runs.length) return [];
  const jobs = db
    .select()
    .from(encodeJobs)
    .where(
      inArray(
        encodeJobs.runId,
        runs.map((r) => r.id),
      ),
    )
    .orderBy(asc(encodeJobs.position))
    .all();
  return runs.map((r) => ({ ...r, jobs: jobs.filter((j) => j.runId === r.id) }));
}

export function latestRun(): RunWithJobs | null {
  const run = db.select().from(encodeRuns).orderBy(desc(encodeRuns.id)).limit(1).get();
  return run ? withJobs([run])[0] : null;
}

export function recentRuns(limit = 20, offset = 0): RunWithJobs[] {
  return withJobs(db.select().from(encodeRuns).orderBy(desc(encodeRuns.id)).limit(limit).offset(offset).all());
}
