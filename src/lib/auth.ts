import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { apiTokens, sessions, users } from '../db/schema';

export type SessionUser = { id: number; username: string; role: 'admin' | 'guest' };

export const SESSION_COOKIE = 'mct_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');

export const hashPassword = (password: string) => hash(password);

export async function verifyLogin(username: string, password: string): Promise<SessionUser | null> {
  const user = db.select().from(users).where(eq(users.username, username.trim())).get();
  // Verify against a dummy hash for unknown users so timing doesn't reveal which usernames exist.
  const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
  return user && ok ? { id: user.id, username: user.username, role: user.role } : null;
}
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$XmDa5afCXNZWUJ61ukKByg$dSQzDi4jgzAulnBEgEIPmfff+k8z6Ie0HXtjevZ2iAw';

export function createSession(userId: number) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  db.insert(sessions).values({ id: sha256(token), userId, expiresAt }).run();
  return { token, expiresAt };
}

/** Returns the user for a session token, extending the session when it is past its half-life. */
export function validateSession(token: string): { user: SessionUser; renewedExpiry: Date | null } | null {
  const id = sha256(token);
  const row = db
    .select({ id: users.id, username: users.username, role: users.role, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .get();
  if (!row) return null;
  let renewedExpiry: Date | null = null;
  if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * DAY) {
    renewedExpiry = new Date(Date.now() + SESSION_DAYS * DAY);
    db.update(sessions).set({ expiresAt: renewedExpiry }).where(eq(sessions.id, id)).run();
  }
  return { user: { id: row.id, username: row.username, role: row.role }, renewedExpiry };
}

export function deleteSession(token: string) {
  db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
}

export function purgeExpiredSessions() {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export async function createUser(username: string, password: string, role: 'admin' | 'guest') {
  const passwordHash = await hashPassword(password);
  return db.insert(users).values({ username: username.trim(), passwordHash, role }).returning().get();
}

export async function setPassword(userId: number, password: string) {
  const passwordHash = await hashPassword(password);
  db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

/** Creates an API token; the raw value is only returned here and never stored. */
export function createApiToken(name: string) {
  const token = `mct_${randomToken()}`;
  db.insert(apiTokens).values({ name: name.trim(), tokenHash: sha256(token) }).run();
  return token;
}

export function validateApiToken(token: string): string | null {
  const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token))).get();
  if (!row) return null;
  db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).run();
  return row.name;
}

// ---- login rate limiting (in memory; single-process app) ------------------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, number[]>();

export function isRateLimited(key: string) {
  const recent = (failures.get(key) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(key: string) {
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/** True when the browser reached us over HTTPS (directly or via the reverse proxy). */
export const isHttps = (request: Request) =>
  request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
