import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function jsonOk(c: Context, data: unknown, status = 200): Response {
  return c.json(data, status as ContentfulStatusCode);
}

export function jsonError(
  c: Context,
  status: number,
  message: string,
  type: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json(
    { error: { message, type, ...extra } },
    status as ContentfulStatusCode,
  );
}

export function authError(c: Context, message = 'Invalid API key'): Response {
  return jsonError(c, 401, message, 'auth_error');
}

export function notFoundError(c: Context, message: string): Response {
  return jsonError(c, 404, message, 'not_found');
}

export function badRequestError(c: Context, message: string, extra: Record<string, unknown> = {}): Response {
  return jsonError(c, 400, message, 'invalid_request', extra);
}
