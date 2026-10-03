import { z } from 'zod';
import type { Task, TaskType, Worker } from '../db/schema';

/**
 * Pure logic for the task queue run by media-pipeline's worker.py; the database
 * side is in tasks.ts. Tasks are a type plus validated parameters, never a
 * command: each worker maps a type to its own command line and refuses paths
 * outside its configured roots, because this app is reachable from the internet.
 */

/** A single folder name: no separators, no `..`, no leading `_` (staging and temp folders). */
export const folderName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[\\/\x00-\x1f]/.test(s) && s !== '.' && s !== '..' && !s.startsWith('_'), 'not a plain folder name');

export const ENCODE_MODES = ['test', 'dry-run', 'full'] as const;

export const encodeParams = z.object({
  /** Folder under the worker's input root (`_to_encode` on the desktop, `_encode` on the server). */
  folder: folderName,
  /** Library folder the output lands in, e.g. "Movies". */
  library: folderName.default('Movies'),
  mode: z.enum(ENCODE_MODES).default('test'),
  film: z.boolean().default(false),
  /** compress_media's --max-height; 0 keeps the source resolution, null uses the profile. */
  maxHeight: z.number().int().min(0).max(4320).nullable().default(null),
  /**
   * Overrides the per-source quality: --crf on the server (x265), --cq on the
   * desktop (NVENC). The scales differ, so the worker picks the flag. null uses
   * the profiles (x265 19 for HD/4K, 23 for DVD; NVENC 23/27).
   */
  quality: z.number().int().min(10).max(35).nullable().default(null),
});

/** Copy a folder from the desktop's `_to_encode` to the server's `_encode`, then queue `then` there. */
export const handoffParams = z.object({
  folder: folderName,
  then: encodeParams.omit({ folder: true }).nullable().default(null),
});

/** A single .mkv file name under the same rules as a folder name. */
export const fileName = folderName.refine((s) => s.toLowerCase().endsWith('.mkv'), 'not an .mkv file');

/** "<folder>" or, for TV, "<show>/<season>". */
export const libraryFolder = z
  .string()
  .trim()
  .refine((s) => {
    const parts = s.split('/');
    return parts.length >= 1 && parts.length <= 2 && parts.every((p) => folderName.safeParse(p).success);
  }, 'not "<folder>" or "<show>/<season>"');

export const REENCODE_LIBRARIES = ['Movies', 'TV Shows'] as const;

/** Re-encode a library file (or every file of a show/season) in place on the server; see reencode.py. */
export const reencodeParams = z.object({
  library: z.enum(REENCODE_LIBRARIES),
  folder: libraryFolder,
  /** One file in the folder; null = every .mkv in it (a show or season). */
  file: fileName.nullable().default(null),
  mode: z.enum(['test', 'full']).default('test'),
  film: z.boolean().default(false),
  maxHeight: z.number().int().min(0).max(4320).nullable().default(null),
  quality: z.number().int().min(10).max(35).nullable().default(null),
  /** Re-encode HEVC sources too (normally skipped). */
  force: z.boolean().default(false),
});

/** A library file path held in _replaced: "<library>/<folder>[/<season>]/<file>.mkv". */
export const heldParams = z.object({
  relPath: z
    .string()
    .refine((s) => {
      const parts = s.split('/');
      return (
        parts.length >= 3 &&
        parts.length <= 4 &&
        (REENCODE_LIBRARIES as readonly string[]).includes(parts[0]) &&
        parts.slice(1, -1).every((p) => folderName.safeParse(p).success) &&
        fileName.safeParse(parts.at(-1)).success
      );
    }, 'not a library file path'),
});

export type EncodeParams = z.infer<typeof encodeParams>;
export type HandoffParams = z.infer<typeof handoffParams>;
export type ReencodeParams = z.infer<typeof reencodeParams>;

export const PARAMS: Record<TaskType, z.ZodType> = {
  encode: encodeParams,
  handoff: handoffParams,
  reencode: reencodeParams,
  'purge-original': heldParams,
  'restore-original': heldParams,
};

// ---- re-encode results -----------------------------------------------------

/** One file in reencode.py's --result JSON. */
export type ReencodeFile = {
  relPath: string;
  status: 'replaced' | 'sample' | 'skipped' | 'failed';
  reason?: string;
  oldSize?: number;
  newSize?: number;
};

export type HeldOriginal = {
  relPath: string;
  /** "original" while the encode is in the library; "encode" after a restore. */
  kind: 'original' | 'encode';
  oldSize: number | null;
  newSize: number | null;
  since: Date | null;
  taskId: number;
};

type ResultRow = { id: number; type: string; status: string; finishedAt: Date | null; result: Record<string, unknown> | null };

/**
 * What sits in _replaced right now, replayed from finished tasks in order: a
 * replace holds the original, a restore swaps in the encode, a purge empties it.
 * Derived rather than stored, so the list can't drift from what the worker did.
 */
export function heldOriginals(rows: ResultRow[]): HeldOriginal[] {
  const held = new Map<string, HeldOriginal>();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.status !== 'done' && row.type !== 'reencode') continue;
    const result = row.result ?? {};
    if (row.type === 'reencode') {
      for (const f of (result.files as ReencodeFile[] | undefined) ?? []) {
        if (f.status !== 'replaced') continue;
        held.set(f.relPath, {
          relPath: f.relPath,
          kind: 'original',
          oldSize: f.oldSize ?? null,
          newSize: f.newSize ?? null,
          since: row.finishedAt,
          taskId: row.id,
        });
      }
    } else if (row.type === 'restore-original') {
      const item = held.get(result.relPath as string);
      if (item) held.set(item.relPath, { ...item, kind: 'encode', since: row.finishedAt, taskId: row.id });
    } else if (row.type === 'purge-original') {
      held.delete(result.relPath as string);
    }
  }
  return [...held.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/** Lowercase without accents, so "gunesin" finds "Güneşin" and "ı" counts as "i". */
const searchKey = (s: string) =>
  s
    .toLocaleLowerCase('en')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

/** True when every word of the query appears in the text (any order); an empty query matches all. */
export function matchesQuery(text: string, query: string) {
  const haystack = searchKey(text);
  return searchKey(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Bytes per hour of runtime, for ranking remuxes; null without both numbers. */
export function bytesPerHour(sizeBytes: number | null, durationS: number | null) {
  return sizeBytes && durationS ? sizeBytes / (durationS / 3600) : null;
}

/** The encoder each worker uses; the worker's own config is what actually decides. */
export const WORKER_ENCODERS: Record<string, string> = { desktop: 'NVENC (GPU)', server: 'x265 (CPU)' };

export function taskTitle(
  type: TaskType,
  params: { folder?: string; mode?: string; file?: string | null; relPath?: string; then?: { mode?: string } | null },
) {
  const mode = params.mode && params.mode !== 'full' ? ` (${params.mode})` : '';
  const leaf = (p?: string) => p?.split('/').at(-1) ?? '';
  switch (type) {
    case 'handoff':
      return `Copy to server: ${params.folder}`;
    case 'reencode':
      return `Re-encode: ${params.file ?? params.folder}${mode}`;
    case 'purge-original':
      return `Delete held original: ${leaf(params.relPath)}`;
    case 'restore-original':
      return `Restore original: ${leaf(params.relPath)}`;
    default:
      return `Encode: ${params.folder}${mode}`;
  }
}

// ---- worker API bodies -----------------------------------------------------

export const claimSchema = z.object({
  capabilities: z.array(z.string().max(50)).max(50).default([]),
  inventory: z.array(z.string().max(255)).max(2000).default([]),
  libraries: z.record(z.string().max(100), z.array(z.string().max(600)).max(2000)).default({}),
});

export const taskUpdateSchema = z.object({
  status: z.enum(['running', 'done', 'failed']).optional(),
  /** Output since the last report, appended to the stored log. */
  log: z.string().max(1_000_000).optional(),
  exitCode: z.number().int().optional(),
  error: z.string().max(2000).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

export type ClaimRequest = z.infer<typeof claimSchema>;
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

// ---- derived state ---------------------------------------------------------

/** Workers report at least every 30 s while running a task, so ten quiet minutes means it died. */
export const STALL_AFTER_MS = 10 * 60 * 1000;
/** An idle worker polls every few seconds. */
export const ONLINE_WITHIN_MS = 2 * 60 * 1000;

export type TaskState = Task['status'] | 'stalled';

export function taskState(task: Pick<Task, 'status' | 'lastSeenAt'>, now = new Date()): TaskState {
  if (task.status !== 'running' || !task.lastSeenAt) return task.status;
  return now.getTime() - task.lastSeenAt.getTime() > STALL_AFTER_MS ? 'stalled' : 'running';
}

export const workerOnline = (w: Pick<Worker, 'lastSeenAt'>, now = new Date()) =>
  !!w.lastSeenAt && now.getTime() - w.lastSeenAt.getTime() <= ONLINE_WITHIN_MS;

const HOURS = /^(\d{1,2})-(\d{1,2})$/;

/** Validates an allowed-hours window like "22-7" (wraps past midnight) or "9-17". */
export function parseHours(spec: string): { start: number; end: number } | null {
  const m = spec.trim().match(HOURS);
  if (!m) return null;
  const [start, end] = [Number(m[1]), Number(m[2])];
  return start <= 23 && end <= 24 ? { start, end } : null;
}

/** True when `hour` is inside the window. Start == end means any hour. */
export function withinHours(spec: string | null, hour: number) {
  if (!spec) return true;
  const w = parseHours(spec);
  if (!w || w.start === w.end % 24) return true;
  return w.start < w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end;
}

/** Whether a worker may start a new task now (local time of this server, TZ Europe/Oslo). */
export function mayClaim(w: Pick<Worker, 'paused' | 'allowedHours'>, now = new Date()) {
  return !w.paused && withinHours(w.allowedHours, now.getHours());
}

/** Only the tail is kept: a long encode prints for hours, and the end is what matters. */
export const LOG_LIMIT = 200_000;

export function appendLog(log: string, chunk: string) {
  const joined = log + chunk;
  if (joined.length <= LOG_LIMIT) return joined;
  const cut = joined.slice(-LOG_LIMIT);
  // Start at a line boundary so the first line isn't half a line.
  const nl = cut.indexOf('\n');
  return `[… earlier output cut]\n${nl >= 0 ? cut.slice(nl + 1) : cut}`;
}
