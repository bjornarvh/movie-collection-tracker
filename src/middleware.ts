import { defineMiddleware } from 'astro:middleware';
import { isHttps, SESSION_COOKIE, validateApiToken, validateSession } from './lib/auth';
import { ensureInit } from './lib/init';

const PUBLIC_PATHS = ['/login', '/healthz', '/favicon.svg', '/favicon.ico'];
/** Pages only the admin may see; guests get read-only access to everything else. */
const ADMIN_PATHS = ['/add', '/review', '/settings', '/upgrades', '/encodes', '/to-rip', '/tasks'];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Same-origin check for cookie-authenticated writes (CSRF). Works behind a TLS-terminating proxy. */
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  await ensureInit();
  const { request, url, cookies, locals } = context;
  locals.user = null;
  locals.apiToken = null;
  const path = url.pathname;

  if (PUBLIC_PATHS.includes(path) || path.startsWith('/_astro/')) return next();

  // --- API: bearer token ---------------------------------------------------
  if (path.startsWith('/api/')) {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
    if (token) {
      locals.apiToken = validateApiToken(token.trim());
      if (!locals.apiToken) return json(401, { error: 'invalid token' });
      return next();
    }
    // Fall through to the session check so the logged-in admin can use GET endpoints in the browser.
  }

  // --- browser: session cookie --------------------------------------------
  const sessionToken = cookies.get(SESSION_COOKIE)?.value;
  const session = sessionToken ? validateSession(sessionToken) : null;
  if (session?.renewedExpiry) {
    cookies.set(SESSION_COOKIE, sessionToken!, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(request),
      expires: session.renewedExpiry,
    });
  }
  if (!session) {
    if (sessionToken) cookies.delete(SESSION_COOKIE, { path: '/' });
    if (path.startsWith('/api/')) return json(401, { error: 'authentication required' });
    const nextParam = path === '/' ? '' : `?next=${encodeURIComponent(path + url.search)}`;
    return context.redirect(`/login${nextParam}`);
  }
  locals.user = session.user;

  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (isWrite && !sameOrigin(request)) {
    return new Response('Cross-site request blocked', { status: 403 });
  }
  const isAdminPath = ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (session.user.role !== 'admin' && (isWrite || isAdminPath || path.startsWith('/api/'))) {
    // Logging out is the one write a guest may do.
    if (!(path === '/logout' && isWrite)) return new Response('Forbidden', { status: 403 });
  }
  return next();
});
