import type { Env } from '../index';
import type { ApiKey } from '../types';
import { kvGet, kvPut, kvDelete, generateId, indexAdd, indexRemove, indexList } from '../utils/kv';
import { generateApiKey, hashApiKey } from '../utils/crypto';

export interface KeyCreateResult {
  key_id: string;
  api_key: string;
  name: string;
  key_prefix: string;
  created_at: number;
}

export async function createKey(env: Env, userId: string, name: string): Promise<KeyCreateResult> {
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData: ApiKey = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name,
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return {
    key_id: keyId,
    api_key: full,
    name,
    key_prefix: prefix,
    created_at: keyData.created_at,
  };
}

export async function listKeys(env: Env, userId: string): Promise<ApiKey[]> {
  const keyIds = await indexList<string>(env, `key_index/${userId}`);
  const keys: ApiKey[] = [];
  for (const keyId of keyIds) {
    const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
    if (key) keys.push(key);
  }
  return keys;
}

export async function getKey(env: Env, userId: string, keyId: string): Promise<ApiKey | null> {
  const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) return null;
  return key;
}

export async function updateKey(
  env: Env,
  userId: string,
  keyId: string,
  updates: { name?: string; is_active?: boolean },
): Promise<ApiKey | null> {
  const key = await getKey(env, userId, keyId);
  if (!key) return null;

  if (updates.name !== undefined) key.name = updates.name;
  if (updates.is_active !== undefined) key.is_active = updates.is_active;

  await kvPut(env, `keys/${keyId}`, key);
  return key;
}

export async function deleteKey(env: Env, userId: string, keyId: string): Promise<boolean> {
  const key = await getKey(env, userId, keyId);
  if (!key) return false;

  await kvDelete(env, `keys/${keyId}`);
  await kvDelete(env, `binding_index/${keyId}`);
  await indexRemove(env, `key_index/${userId}`, (id: string) => id === keyId);
  await indexRemove(env, `key_prefix_index/${key.key_prefix}`, (id: string) => id === keyId);

  return true;
}

export { type ApiKey };
