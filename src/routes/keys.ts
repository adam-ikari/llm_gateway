import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as keyService from '../services/key';
import { jsonOk, badRequestError, notFoundError } from '../utils/response';

const keyRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

keyRoutes.use('*', authMiddleware);

keyRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name) {
    return badRequestError(c, 'Key name is required');
  }

  const auth = c.get('auth');
  const result = await keyService.createKey(c.env, auth.user_id, body.name);
  return jsonOk(c, result, 201);
});

keyRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const keys = await keyService.listKeys(c.env, auth.user_id);
  return jsonOk(
    c,
    keys.map((k) => ({
      key_id: k.key_id,
      name: k.name,
      key_prefix: k.key_prefix,
      is_active: k.is_active,
      created_at: k.created_at,
    })),
  );
});

keyRoutes.get('/:key_id', async (c) => {
  const auth = c.get('auth');
  const key = await keyService.getKey(c.env, auth.user_id, c.req.param('key_id'));
  if (!key) return notFoundError(c, 'Key not found');
  return jsonOk(c, {
    key_id: key.key_id,
    name: key.name,
    key_prefix: key.key_prefix,
    is_active: key.is_active,
    created_at: key.created_at,
  });
});

keyRoutes.patch('/:key_id', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{ name?: string; is_active?: boolean }>();
  const key = await keyService.updateKey(c.env, auth.user_id, c.req.param('key_id'), body);
  if (!key) return notFoundError(c, 'Key not found');
  return jsonOk(c, {
    key_id: key.key_id,
    name: key.name,
    key_prefix: key.key_prefix,
    is_active: key.is_active,
    created_at: key.created_at,
  });
});

keyRoutes.delete('/:key_id', async (c) => {
  const auth = c.get('auth');
  const deleted = await keyService.deleteKey(c.env, auth.user_id, c.req.param('key_id'));
  if (!deleted) return notFoundError(c, 'Key not found');
  return jsonOk(c, { deleted: true });
});

export { keyRoutes };
