import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { proxyRequest } from '../services/proxy';
import { badRequestError } from '../utils/response';
import type { OpenAIRequest } from '../types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

const proxyRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

proxyRoutes.use('*', authMiddleware);

proxyRoutes.post('/chat/completions', async (c) => {
  const body = await c.req.json<OpenAIRequest>();
  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    return badRequestError(c, 'model and messages are required');
  }

  const auth = c.get('auth');
  const outcome = await proxyRequest(c.env, auth.key_id, auth.user_id, body);

  if ('error' in outcome) {
    return c.json(JSON.parse(outcome.error.body), outcome.error.status as ContentfulStatusCode);
  }

  return c.json(JSON.parse(outcome.result.body), outcome.result.status as ContentfulStatusCode);
});

export { proxyRoutes };
