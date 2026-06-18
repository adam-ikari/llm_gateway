import type { Context, Next } from 'hono';
import type { Env } from '../index';
import type { ApiKey } from '../types';
import { kvGet } from '../utils/kv';
import { hashApiKey } from '../utils/crypto';
import { authError } from '../utils/response';

export interface AuthContext {
  key_id: string;
  user_id: string;
}

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: { auth: AuthContext } }>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return authError(c, 'Missing or invalid Authorization header');
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
    return authError(c, 'Invalid API key format');
  }

  const keyHash = await hashApiKey(apiKey);
  const prefix = apiKey.slice(0, 11);

  const candidates = await kvGet<string[]>(c.env, `key_prefix_index:${prefix}`) || [];

  for (const keyId of candidates) {
    const keyData = await kvGet<ApiKey>(c.env, `keys/${keyId}`);
    if (keyData && keyData.key_hash === keyHash && keyData.is_active) {
      c.set('auth', { key_id: keyData.key_id, user_id: keyData.user_id } as AuthContext);
      return next();
    }
  }

  return authError(c, 'Invalid API key');
}
