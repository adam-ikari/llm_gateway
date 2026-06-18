import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { getEndpoint, listEndpoints } from '../services/endpoint';
import { getBillingHandler } from '../billing/registry';
import { jsonOk, notFoundError } from '../utils/response';

// Import all billing handlers to register them
import '../billing/openai';
import '../billing/anthropic';
import '../billing/deepseek';
import '../billing/moonshot';
import '../billing/zhipu';
import '../billing/aliyun';

const billingRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

billingRoutes.use('*', authMiddleware);

billingRoutes.get('/endpoints/:endpoint_id/balance', async (c) => {
  const auth = c.get('auth');
  const ep = await getEndpoint(c.env, auth.user_id, c.req.param('endpoint_id'));
  if (!ep) return notFoundError(c, 'Endpoint not found');

  const handler = getBillingHandler(ep.format);
  if (!handler) {
    return jsonOk(c, {
      endpoint_id: ep.endpoint_id,
      endpoint_name: ep.name,
      provider: ep.format,
      balance: { available: false },
    });
  }

  const balance = await handler.queryBalance(ep.api_key, ep.base_url);
  return jsonOk(c, {
    endpoint_id: ep.endpoint_id,
    endpoint_name: ep.name,
    provider: handler.provider,
    balance,
  });
});

billingRoutes.get('/endpoints/balances', async (c) => {
  const auth = c.get('auth');
  const endpoints = await listEndpoints(c.env, auth.user_id);

  const results = [];
  for (const ep of endpoints) {
    const handler = getBillingHandler(ep.format);
    const balance = handler ? await handler.queryBalance(ep.api_key, ep.base_url) : { available: false };

    results.push({
      endpoint_id: ep.endpoint_id,
      endpoint_name: ep.name,
      provider: handler?.provider || ep.format,
      balance,
    });
  }

  return jsonOk(c, { balances: results });
});

export { billingRoutes };
