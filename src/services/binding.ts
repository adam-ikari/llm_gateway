import type { Env } from '../index';
import type { ApiKey, Binding } from '../types';
import { kvPut, kvGet, kvDelete } from '../utils/kv';

export interface BindingInput {
  model_name: string;
  endpoint_id: string;
  request_types?: string[];
  priority?: number;
}

function bindingKey(keyId: string, modelName: string): string {
  return `bindings/${keyId}:${modelName}`;
}

export async function setBindings(
  env: Env,
  userId: string,
  keyId: string,
  bindings: BindingInput[],
): Promise<Binding[]> {
  // Verify key belongs to user
  const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) {
    throw new Error('Key not found');
  }

  // Get existing bindings for this key to clean up
  const existingIndex =
    (await kvGet<{ model_name: string; endpoint_id: string }[]>(env, `binding_index/${keyId}`)) || [];
  for (const existing of existingIndex) {
    await kvDelete(env, bindingKey(keyId, existing.model_name));
  }

  // Write new bindings
  const fullBindings: Binding[] = [];
  const newIndex: { model_name: string; endpoint_id: string }[] = [];

  for (const b of bindings) {
    const binding: Binding = {
      key_id: keyId,
      model_name: b.model_name,
      endpoint_id: b.endpoint_id,
      priority: b.priority ?? 0,
      request_types: b.request_types ?? ['text'],
    };
    await kvPut(env, bindingKey(keyId, b.model_name), binding);
    fullBindings.push(binding);
    newIndex.push({ model_name: b.model_name, endpoint_id: b.endpoint_id });
  }

  await kvPut(env, `binding_index/${keyId}`, newIndex);
  return fullBindings;
}

export async function getBindings(env: Env, userId: string, keyId: string): Promise<Binding[]> {
  const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) {
    throw new Error('Key not found');
  }

  const index = (await kvGet<{ model_name: string; endpoint_id: string }[]>(env, `binding_index/${keyId}`)) || [];
  const bindings: Binding[] = [];
  for (const entry of index) {
    const binding = await kvGet<Binding>(env, bindingKey(keyId, entry.model_name));
    if (binding) bindings.push(binding);
  }
  return bindings;
}

export async function getBindingForModel(env: Env, keyId: string, modelName: string): Promise<Binding | null> {
  return kvGet<Binding>(env, bindingKey(keyId, modelName));
}
