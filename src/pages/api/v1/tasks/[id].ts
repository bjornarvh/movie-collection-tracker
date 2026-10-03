import type { APIRoute } from 'astro';
import { taskUpdateSchema } from '../../../../lib/task-queue';
import { updateTask } from '../../../../lib/tasks';
import { json, parseBody } from '../_json';

/** A running task reports output, a heartbeat (`{}`) or its end; the reply says whether to cancel. */
export const PATCH: APIRoute = async ({ params, request }) => {
  const body = await parseBody(request, taskUpdateSchema);
  if (body.error) return body.error;
  const result = updateTask(Number(params.id), body.data);
  if (!result) return json({ error: 'no such task' }, 404);
  return json({ id: result.task.id, status: result.task.status, cancel: result.cancel });
};
