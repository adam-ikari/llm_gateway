import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { getStats, getKeyStats, getModelStats } from '../services/stats';
import { jsonOk, notFoundError } from '../utils/response';

const statsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

statsRoutes.use('*', authMiddleware);

statsRoutes.get('/', async (c) => {
  const date = c.req.query('date');
  const stats = await getStats(c.env, c.get('auth').user_id, date);
  return jsonOk(c, stats);
});

statsRoutes.get('/keys/:key_id', async (c) => {
  const date = c.req.query('date');
  const stats = await getKeyStats(c.env, c.get('auth').user_id, c.req.param('key_id'), date);
  if (!stats) return notFoundError(c, 'No stats found for this key');
  return jsonOk(c, stats);
});

statsRoutes.get('/models/:model_name', async (c) => {
  const date = c.req.query('date');
  const stats = await getModelStats(c.env, c.get('auth').user_id, c.req.param('model_name'), date);
  if (!stats) return notFoundError(c, 'No stats found for this model');
  return jsonOk(c, stats);
});

export { statsRoutes };
