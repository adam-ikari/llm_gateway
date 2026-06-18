import type { Env } from '../index';
import type { Endpoint, EndpointModel } from '../types';
import { kvGet, kvPut, kvDelete, generateId, indexAdd, indexRemove, indexList } from '../utils/kv';

export interface CreateEndpointInput {
  name: string;
  base_url: string;
  api_key: string;
  format: 'openai' | 'anthropic' | 'gemini';
  supported_models: EndpointModel[];
}

export async function createEndpoint(env: Env, userId: string, input: CreateEndpointInput): Promise<Endpoint> {
  const endpointId = generateId('ep');
  const endpoint: Endpoint = {
    endpoint_id: endpointId,
    user_id: userId,
    name: input.name,
    base_url: input.base_url,
    api_key: input.api_key,
    format: input.format,
    supported_models: input.supported_models,
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  await kvPut(env, `endpoints/${endpointId}`, endpoint);
  await indexAdd(env, `endpoint_index/${userId}`, endpointId);

  return endpoint;
}

export async function listEndpoints(env: Env, userId: string): Promise<Endpoint[]> {
  const epIds = await indexList<string>(env, `endpoint_index/${userId}`);
  const endpoints: Endpoint[] = [];
  for (const epId of epIds) {
    const ep = await kvGet<Endpoint>(env, `endpoints/${epId}`);
    if (ep) endpoints.push(ep);
  }
  return endpoints;
}

export async function getEndpoint(env: Env, userId: string, endpointId: string): Promise<Endpoint | null> {
  const ep = await kvGet<Endpoint>(env, `endpoints/${endpointId}`);
  if (!ep || ep.user_id !== userId) return null;
  return ep;
}

export async function updateEndpoint(
  env: Env,
  userId: string,
  endpointId: string,
  updates: Partial<CreateEndpointInput>,
): Promise<Endpoint | null> {
  const ep = await getEndpoint(env, userId, endpointId);
  if (!ep) return null;

  if (updates.name !== undefined) ep.name = updates.name;
  if (updates.base_url !== undefined) ep.base_url = updates.base_url;
  if (updates.api_key !== undefined) ep.api_key = updates.api_key;
  if (updates.format !== undefined) ep.format = updates.format;
  if (updates.supported_models !== undefined) ep.supported_models = updates.supported_models;
  ep.updated_at = Date.now();

  await kvPut(env, `endpoints/${endpointId}`, ep);
  return ep;
}

export async function deleteEndpoint(env: Env, userId: string, endpointId: string): Promise<boolean> {
  const ep = await getEndpoint(env, userId, endpointId);
  if (!ep) return false;

  await kvDelete(env, `endpoints/${endpointId}`);
  await indexRemove(env, `endpoint_index/${userId}`, (id: string) => id === endpointId);

  return true;
}
