import type { APIRoute } from 'astro';
import { deleteSession, SESSION_COOKIE } from '../lib/auth';

export const POST: APIRoute = ({ cookies, redirect }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return redirect('/login', 303);
};
