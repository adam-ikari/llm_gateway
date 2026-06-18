import type { Env } from '../index';

export async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvPut<T>(env: Env, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}

export async function kvDelete(env: Env, key: string): Promise<void> {
  await env.KV.delete(key);
}

// ========== Index helpers (KV doesn't support list operations) ==========

export async function indexAdd<T>(env: Env, indexKey: string, item: T): Promise<void> {
  const current = await kvGet<T[]>(env, indexKey) || [];
  current.push(item);
  await kvPut(env, indexKey, current);
}

export async function indexRemove<T>(
  env: Env,
  indexKey: string,
  predicate: (item: T) => boolean,
): Promise<void> {
  const current = await kvGet<T[]>(env, indexKey) || [];
  await kvPut(env, indexKey, current.filter((item) => !predicate(item)));
}

export async function indexList<T>(env: Env, indexKey: string): Promise<T[]> {
  return (await kvGet<T[]>(env, indexKey)) || [];
}

export function generateId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${random}`;
}
