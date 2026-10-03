import { and, asc, desc, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { files, tasks, workers, type Task, type TaskType, type Worker } from '../db/schema';
import {
  appendLog,
  chainState,
  heldOriginals,
  SUBTITLE_TYPES,
  mayClaim,
  PARAMS,
  taskTitle,
  type ClaimRequest,
  type ReencodeFile,
  type TaskUpdate,
} from './task-queue';

/** Queue a task for one worker. Throws a ZodError when the parameters are invalid. */
export function enqueue(type: TaskType, worker: string, params: unknown, parentId: number | null = null): Task {
  const parsed = PARAMS[type].parse(params) as Record<string, unknown>;
  return db
    .insert(tasks)
    .values({ type, worker, params: parsed, title: taskTitle(type, parsed), parentId })
    .returning()
    .get();
}

/**
 * A worker asks for work. Records what it can do and which folders it has, closes
 * tasks it was running before it restarted (an idle worker has nothing running),
 * then hands out its oldest queued task it can run, unless it is paused or outside
 * its allowed hours.
 */
export function claimNext(name: string, req: ClaimRequest, now = new Date()): Task | null {
  return db.transaction((tx) => {
    const worker = tx
      .insert(workers)
      .values({ name, capabilities: req.capabilities, inventory: req.inventory, libraries: req.libraries, lastSeenAt: now })
      .onConflictDoUpdate({
        target: workers.name,
        set: { capabilities: req.capabilities, inventory: req.inventory, libraries: req.libraries, lastSeenAt: now },
      })
      .returning()
      .get();

    const orphans = tx
      .update(tasks)
      .set({ status: 'failed', error: 'the worker restarted before finishing', finishedAt: now })
      .where(and(eq(tasks.worker, name), eq(tasks.status, 'running')))
      .returning({ id: tasks.id })
      .all();
    for (const orphan of orphans) cancelChildren(orphan.id, now);

    if (!mayClaim(worker, now) || !req.capabilities.length) return null;
    const candidates = tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.worker, name), eq(tasks.status, 'queued'), inArray(tasks.type, req.capabilities as TaskType[])))
      .orderBy(asc(tasks.id))
      .all();
    // A chained step waits for the one before it, and goes when that failed.
    let next: Task | undefined;
    for (const candidate of candidates) {
      const parent = candidate.parentId ? tx.select().from(tasks).where(eq(tasks.id, candidate.parentId)).get() : undefined;
      const state = chainState(candidate.parentId ? (parent?.status ?? 'cancelled') : null);
      if (state === 'ready') {
        next = candidate;
        break;
      }
      if (state === 'cancel') cancelChain(candidate.id, now, 'an earlier step did not finish');
    }
    if (!next) return null;
    return tx
      .update(tasks)
      .set({ status: 'running', startedAt: now, lastSeenAt: now })
      .where(eq(tasks.id, next.id))
      .returning()
      .get();
  });
}

/**
 * A running task reports output, a heartbeat (empty body) or its end. Returns
 * whether the worker should cancel it. A handoff that finished queues its
 * follow-up encode on the server.
 */
export function updateTask(id: number, u: TaskUpdate, now = new Date()) {
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;
  if (task.status !== 'running') return { task, cancel: true };

  const set: Partial<typeof tasks.$inferInsert> = { lastSeenAt: now };
  if (u.log) set.log = appendLog(task.log, u.log);
  if (u.progress !== undefined) set.progress = u.progress || null;
  if (u.exitCode !== undefined) set.exitCode = u.exitCode;
  if (u.error !== undefined) set.error = u.error;
  if (u.result !== undefined) set.result = u.result;
  if (u.status === 'done' || u.status === 'failed') {
    set.status = u.status === 'failed' && task.cancelRequested ? 'cancelled' : u.status;
    set.finishedAt = now;
    set.progress = null;
  }
  const updated = db.update(tasks).set(set).where(eq(tasks.id, id)).returning().get();
  // A busy worker reports to its task instead of polling; it is still online.
  db.update(workers).set({ lastSeenAt: now }).where(eq(workers.name, task.worker)).run();

  if (updated.type === 'reencode' && u.result) applyReencode(u.result);
  if (updated.type === 'restore-original' && updated.status === 'done') applyRestore(updated.params.relPath as string, updated.id);

  if (updated.status === 'failed' || updated.status === 'cancelled') cancelChildren(updated.id, now);
  if (updated.finishedAt && (SUBTITLE_TYPES as readonly string[]).includes(updated.type)) afterSubtitleTask(updated);

  if (updated.status === 'done' && updated.type === 'handoff') {
    const then = (updated.params as { then?: Record<string, unknown> | null }).then;
    if (then) enqueue('encode', 'server', { ...then, folder: updated.params.folder }, updated.id);
  }
  return { task: updated, cancel: updated.cancelRequested };
}

/**
 * A replaced file keeps its path, so its row and copy link stay; update what
 * changed now instead of waiting for the next Plex scan (which refreshes the
 * rest by path). TV files are not in the tracker, so they simply don't match.
 */
function applyReencode(result: Record<string, unknown>) {
  for (const f of (result.files as ReencodeFile[] | undefined) ?? []) {
    if (f.status !== 'replaced' || !f.newSize) continue;
    db.update(files).set({ codec: 'hevc', sizeBytes: f.newSize }).where(eq(files.relPath, f.relPath)).run();
  }
}

/**
 * The original is back under the same path: its size is known from the
 * re-encode, its codec isn't, so clear that for the next Plex scan to fill in
 * (meanwhile the file shows up again as a re-encode candidate, which it is).
 */
function applyRestore(relPath: string, restoreTaskId: number) {
  const before = heldOriginals(
    db
      .select({ id: tasks.id, type: tasks.type, status: tasks.status, finishedAt: tasks.finishedAt, result: tasks.result })
      .from(tasks)
      .where(inArray(tasks.type, ['reencode', 'purge-original', 'restore-original']))
      .all()
      .filter((t) => t.id < restoreTaskId),
  ).find((h) => h.relPath === relPath);
  db.update(files)
    .set({ codec: null, ...(before?.oldSize ? { sizeBytes: before.oldSize } : {}) })
    .where(eq(files.relPath, relPath))
    .run();
}

/** Originals currently held in _replaced, from the results of finished tasks. */
export function listHeldOriginals() {
  const rows = db
    .select({ id: tasks.id, type: tasks.type, status: tasks.status, finishedAt: tasks.finishedAt, result: tasks.result })
    .from(tasks)
    .where(inArray(tasks.type, ['reencode', 'purge-original', 'restore-original']))
    .all();
  return heldOriginals(rows);
}

/** Re-encode-related tasks not finished yet, for marking rows as in progress. */
export function openReencodeTasks(): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.type, ['reencode', 'purge-original', 'restore-original']), inArray(tasks.status, ['queued', 'running'])))
    .all();
}

/** Cancel a queued task and everything chained after it. */
function cancelChain(id: number, now: Date, reason: string) {
  db.update(tasks)
    .set({ status: 'cancelled', finishedAt: now, error: reason })
    .where(and(eq(tasks.id, id), eq(tasks.status, 'queued')))
    .run();
  cancelChildren(id, now);
}

function cancelChildren(parentId: number, now: Date) {
  for (const child of db.select().from(tasks).where(and(eq(tasks.parentId, parentId), eq(tasks.status, 'queued'))).all()) {
    cancelChain(child.id, now, 'an earlier step did not finish');
  }
}

/**
 * Subtitle status comes from a scan of D:\Video, run when asked: after every
 * subtitle step (unless a scan is already waiting), and when a scan lands, the
 * older scans' results are dropped so the table doesn't grow with copies.
 */
function afterSubtitleTask(task: Task) {
  if (task.type !== 'subtitle-scan') {
    queueScan();
    return;
  }
  if (task.status === 'done' && task.result) {
    db.update(tasks)
      .set({ result: null })
      .where(and(eq(tasks.type, 'subtitle-scan'), lt(tasks.id, task.id), isNotNull(tasks.result)))
      .run();
  }
}

/** Queue a subtitle scan on the desktop unless one is already waiting. */
export function queueScan() {
  const waiting = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.type, 'subtitle-scan'), eq(tasks.status, 'queued')))
    .get();
  return waiting ?? enqueue('subtitle-scan', 'desktop', {});
}

/** The newest finished subtitle scan, or null before the first one. */
export function latestScan() {
  return (
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.type, 'subtitle-scan'), eq(tasks.status, 'done'), isNotNull(tasks.result)))
      .orderBy(desc(tasks.id))
      .limit(1)
      .get() ?? null
  );
}

/** Subtitle tasks not finished yet, for marking series as busy. */
export function openSubtitleTasks(): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.type, [...SUBTITLE_TYPES]), inArray(tasks.status, ['queued', 'running']), ne(tasks.type, 'subtitle-scan')))
    .all();
}

/** Queue steps as a chain: each waits for the previous one to finish cleanly. */
export function enqueueChain(worker: string, steps: { type: TaskType; params: Record<string, unknown> }[]) {
  let parent: number | null = null;
  const queued: Task[] = [];
  for (const step of steps) {
    const task = enqueue(step.type, worker, step.params, parent);
    queued.push(task);
    parent = task.id;
  }
  return queued;
}

/** A queued task is dropped at once; a running one is told to stop on its next report. */
export function cancelTask(id: number, now = new Date()) {
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;
  if (task.status === 'queued') {
    const cancelled = db.update(tasks).set({ status: 'cancelled', finishedAt: now }).where(eq(tasks.id, id)).returning().get();
    cancelChildren(id, now);
    return cancelled;
  }
  if (task.status === 'running') {
    return db.update(tasks).set({ cancelRequested: true }).where(eq(tasks.id, id)).returning().get();
  }
  return task;
}

/** Queue the same task again. */
export const retryTask = (task: Task) => enqueue(task.type, task.worker, task.params, task.parentId);

export const getTask = (id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get() ?? null;

export function recentTasks(limit = 50): Task[] {
  return db.select().from(tasks).orderBy(desc(tasks.id)).limit(limit).all();
}

/** Tasks being worked on right now, one per worker at most. */
export function runningTasks(): Task[] {
  return db.select().from(tasks).where(eq(tasks.status, 'running')).all();
}

export function childTasks(id: number): Task[] {
  return db.select().from(tasks).where(eq(tasks.parentId, id)).orderBy(asc(tasks.id)).all();
}

export function listWorkers(): Worker[] {
  return db.select().from(workers).orderBy(asc(workers.name)).all();
}

export const getWorker = (name: string) => db.select().from(workers).where(eq(workers.name, name)).get() ?? null;

export function setWorker(name: string, set: Partial<Pick<Worker, 'paused' | 'allowedHours'>>) {
  db.update(workers).set(set).where(eq(workers.name, name)).run();
}
