import { FORMATS, OWNERSHIPS, type Format, type Ownership } from '../db/schema';

export const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

export const int = (form: FormData, key: string) => {
  const n = Number(str(form, key));
  return Number.isInteger(n) ? n : null;
};

export const ints = (form: FormData, key: string) =>
  form
    .getAll(key)
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));

export const oneOf = <T extends string>(values: readonly T[], v: string): T | null =>
  (values as readonly string[]).includes(v) ? (v as T) : null;

export const formatOf = (form: FormData, key = 'format') => oneOf<Format>(FORMATS, str(form, key));
export const ownershipOf = (form: FormData, key = 'ownership') => oneOf<Ownership>(OWNERSHIPS, str(form, key));
export const targetOf = (form: FormData, key = 'target') => oneOf(['bluray', 'uhd'] as const, str(form, key));

/** Post/redirect/get with a flash message carried in the query string. */
export function back(url: URL, msg: { ok?: string; err?: string }, keep: string[] = []) {
  const next = new URL(url.pathname, url);
  for (const k of keep) {
    const v = url.searchParams.get(k);
    if (v) next.searchParams.set(k, v);
  }
  if (msg.ok) next.searchParams.set('ok', msg.ok);
  if (msg.err) next.searchParams.set('err', msg.err);
  return new Response(null, { status: 303, headers: { Location: next.pathname + next.search } });
}

/** Keep the current filters when redirecting after a POST. */
export function backWithQuery(url: URL, msg: { ok?: string; err?: string }) {
  const keep = [...url.searchParams.keys()].filter((k) => k !== 'ok' && k !== 'err');
  return back(url, msg, keep);
}

/** Only allow same-site relative redirects (for ?next= after login). */
export const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
