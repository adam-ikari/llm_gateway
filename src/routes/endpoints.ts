import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as endpointService from '../services/endpoint';
import { jsonOk, badRequestError, notFoundError } from '../utils/response';

const VALID_FORMATS = ['openai', 'anthropic', 'gemini'];

const endpointRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

endpointRoutes.use('*', authMiddleware);

endpointRoutes.post('/', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.base_url || !body.api_key || !body.format || !body.supported_models) {
    return badRequestError(c, 'name, base_url, api_key, format, and supported_models are required');
  }
  if (!VALID_FORMATS.includes(body.format)) {
    return badRequestError(c, `format must be one of: ${VALID_FORMATS.join(', ')}`);
  }
  if (!Array.isArray(body.supported_models) || body.supported_models.length === 0) {
    return badRequestError(c, 'supported_models must be a non-empty array');
  }
  for (const m of body.supported_models) {
    if (!m.name || !m.real_model || !m.context_window) {
      return badRequestError(c, 'Each model must have name, real_model, and context_window');
    }
  }

  const endpoint = await endpointService.createEndpoint(c.env, c.get('auth').user_id, body);
  return jsonOk(c, endpoint, 201);
});

endpointRoutes.get('/', async (c) => {
  const endpoints = await endpointService.listEndpoints(c.env, c.get('auth').user_id);
  return jsonOk(c, endpoints);
});

endpointRoutes.get('/:endpoint_id', async (c) => {
  const ep = await endpointService.getEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'));
  if (!ep) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, ep);
});

endpointRoutes.put('/:endpoint_id', async (c) => {
  const body = await c.req.json();
  if (body.format && !VALID_FORMATS.includes(body.format)) {
    return badRequestError(c, `format must be one of: ${VALID_FORMATS.join(', ')}`);
  }

  const ep = await endpointService.updateEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'), body);
  if (!ep) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, ep);
});

endpointRoutes.delete('/:endpoint_id', async (c) => {
  const deleted = await endpointService.deleteEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'));
  if (!deleted) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, { deleted: true });
});

export { endpointRoutes };
