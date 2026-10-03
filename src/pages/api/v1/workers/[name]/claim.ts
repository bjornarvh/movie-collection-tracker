import type { APIRoute } from 'astro';
import { claimSchema } from '../../../../../lib/task-queue';
import { claimNext } from '../../../../../lib/tasks';
import { json, parseBody } from '../../_json';

/** worker.py polls for its next task. 204 when there is nothing to do (or it is paused). */
export const POST: APIRoute = async ({ params, request }) => {
  const name = params.name!;
  if (!/^[a-z0-9-]{1,40}$/.test(name)) return json({ error: 'invalid worker name' }, 400);
  const body = await parseBody(request, claimSchema);
  if (body.error) return body.error;
  const task = claimNext(name, body.data);
  return task ? json(task) : new Response(null, { status: 204 });
};
