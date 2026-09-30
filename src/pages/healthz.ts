import type { APIRoute } from 'astro';
import { sqlite } from '../db/client';

export const GET: APIRoute = () => {
  sqlite.prepare('select 1').get();
  return new Response('ok');
};
