import type { Env } from '../index';
import type { Stats, StatsByEntity } from '../types';
import { kvGet, kvPut } from '../utils/kv';

function statsKey(userId: string, date: string): string {
  return `stats/${userId}:${date}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyByEntity(): StatsByEntity {
  return { requests: 0, tokens: 0, avg_response_time_ms: 0, status_codes: {} };
}

function emptyStats(): Stats {
  return {
    total_requests: 0,
    total_tokens: 0,
    avg_response_time_ms: 0,
    status_codes: {},
    by_key: {},
    by_model: {},
  };
}

export async function recordStats(
  env: Env,
  userId: string,
  keyId: string,
  modelName: string,
  data: { tokens: number; responseTimeMs: number; statusCode: number },
): Promise<void> {
  const key = statsKey(userId, today());
  let stats = (await kvGet<Stats>(env, key)) || emptyStats();

  const oldTotalReqs = stats.total_requests;
  stats.total_requests += 1;
  stats.total_tokens += data.tokens;
  stats.avg_response_time_ms =
    (stats.avg_response_time_ms * oldTotalReqs + data.responseTimeMs) / stats.total_requests;

  const codeStr = String(data.statusCode);
  stats.status_codes[codeStr] = (stats.status_codes[codeStr] || 0) + 1;

  if (!stats.by_key[keyId]) stats.by_key[keyId] = emptyByEntity();
  const bk = stats.by_key[keyId];
  bk.requests += 1;
  bk.tokens += data.tokens;
  bk.avg_response_time_ms = (bk.avg_response_time_ms * (bk.requests - 1) + data.responseTimeMs) / bk.requests;
  bk.status_codes[codeStr] = (bk.status_codes[codeStr] || 0) + 1;

  if (!stats.by_model[modelName]) stats.by_model[modelName] = emptyByEntity();
  const bm = stats.by_model[modelName];
  bm.requests += 1;
  bm.tokens += data.tokens;
  bm.avg_response_time_ms = (bm.avg_response_time_ms * (bm.requests - 1) + data.responseTimeMs) / bm.requests;
  bm.status_codes[codeStr] = (bm.status_codes[codeStr] || 0) + 1;

  await kvPut(env, key, stats);
}

export async function getStats(env: Env, userId: string, date?: string): Promise<Stats> {
  const key = statsKey(userId, date || today());
  return (await kvGet<Stats>(env, key)) || emptyStats();
}

export async function getKeyStats(env: Env, userId: string, keyId: string, date?: string): Promise<StatsByEntity | null> {
  const stats = await getStats(env, userId, date);
  return stats.by_key[keyId] || null;
}

export async function getModelStats(env: Env, userId: string, modelName: string, date?: string): Promise<StatsByEntity | null> {
  const stats = await getStats(env, userId, date);
  return stats.by_model[modelName] || null;
}
