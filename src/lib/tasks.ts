import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { tasks, workers, type Task, type TaskType, type Worker } from '../db/schema';
import { appendLog, mayClaim, PARAMS, taskTitle, type ClaimRequest, type TaskUpdate } from './task-queue';

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
      .values({ name, capabilities: req.capabilities, inventory: req.inventory, lastSeenAt: now })
      .onConflictDoUpdate({
        target: workers.name,
        set: { capabilities: req.capabilities, inventory: req.inventory, lastSeenAt: now },
      })
      .returning()
      .get();

    tx.update(tasks)
      .set({ status: 'failed', error: 'the worker restarted before finishing', finishedAt: now })
      .where(and(eq(tasks.worker, name), eq(tasks.status, 'running')))
      .run();

    if (!mayClaim(worker, now) || !req.capabilities.length) return null;
    const next = tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.worker, name),
          eq(tasks.status, 'queued'),
          inArray(tasks.type, req.capabilities as TaskType[]),
        ),
      )
      .orderBy(asc(tasks.id))
      .limit(1)
      .get();
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
  if (u.exitCode !== undefined) set.exitCode = u.exitCode;
  if (u.error !== undefined) set.error = u.error;
  if (u.status === 'done' || u.status === 'failed') {
    set.status = u.status === 'failed' && task.cancelRequested ? 'cancelled' : u.status;
    set.finishedAt = now;
  }
  const updated = db.update(tasks).set(set).where(eq(tasks.id, id)).returning().get();

  if (updated.status === 'done' && updated.type === 'handoff') {
    const then = (updated.params as { then?: Record<string, unknown> | null }).then;
    if (then) enqueue('encode', 'server', { ...then, folder: updated.params.folder }, updated.id);
  }
  return { task: updated, cancel: updated.cancelRequested };
}

/** A queued task is dropped at once; a running one is told to stop on its next report. */
export function cancelTask(id: number, now = new Date()) {
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;
  if (task.status === 'queued') {
    return db.update(tasks).set({ status: 'cancelled', finishedAt: now }).where(eq(tasks.id, id)).returning().get();
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
