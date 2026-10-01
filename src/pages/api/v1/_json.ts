import type { z } from 'zod';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } });

/** Parse a JSON body against a zod schema; on failure `error` holds the 400 response to return. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S>; error?: undefined } | { data?: undefined; error: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: json({ error: 'body must be JSON' }, 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { error: json({ error: 'invalid request', issues: parsed.error.issues }, 400) };
  return { data: parsed.data };
}
