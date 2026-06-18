import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as bindingService from '../services/binding';
import { jsonOk, badRequestError, jsonError } from '../utils/response';

const bindingRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

bindingRoutes.use('*', authMiddleware);

bindingRoutes.put('/:key_id/bindings', async (c) => {
  const body = await c.req.json<{ bindings: bindingService.BindingInput[] }>();
  if (!body.bindings || !Array.isArray(body.bindings)) {
    return badRequestError(c, 'bindings array is required');
  }

  try {
    const result = await bindingService.setBindings(c.env, c.get('auth').user_id, c.req.param('key_id'), body.bindings);
    return jsonOk(c, { bindings: result });
  } catch (e) {
    if (e instanceof Error && e.message === 'Key not found') {
      return jsonError(c, 404, 'Key not found', 'not_found');
    }
    throw e;
  }
});

bindingRoutes.get('/:key_id/bindings', async (c) => {
  try {
    const bindings = await bindingService.getBindings(c.env, c.get('auth').user_id, c.req.param('key_id'));
    return jsonOk(c, { bindings });
  } catch (e) {
    if (e instanceof Error && e.message === 'Key not found') {
      return jsonError(c, 404, 'Key not found', 'not_found');
    }
    throw e;
  }
});

export { bindingRoutes };
