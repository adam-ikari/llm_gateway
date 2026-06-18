import { Hono } from 'hono';
import type { Env } from '../index';
import { registerUser, loginUser, AuthError } from '../services/auth';
import { jsonOk, jsonError, badRequestError } from '../utils/response';

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    return badRequestError(c, 'Email and password are required');
  }
  if (body.password.length < 8) {
    return badRequestError(c, 'Password must be at least 8 characters');
  }

  try {
    const result = await registerUser(c.env, body);
    return jsonOk(c, result, 201);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(c, 409, e.message, 'conflict');
    }
    throw e;
  }
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    return badRequestError(c, 'Email and password are required');
  }

  try {
    const result = await loginUser(c.env, body);
    return jsonOk(c, result);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(c, 401, e.message, 'auth_error');
    }
    throw e;
  }
});

export { authRoutes };
