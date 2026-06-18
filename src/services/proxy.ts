import type { Env } from '../index';
import type { OpenAIRequest, SSEEvent } from '../types';
import type { Transformer } from '../transformer/types';
import { openaiTransformer } from '../transformer/openai';
import { anthropicTransformer } from '../transformer/anthropic';
import { geminiTransformer } from '../transformer/gemini';
import { routeRequest } from '../router/index';
import { recordStats } from './stats';
import { parseSSEStream, serializeSSEStream, streamHeaders } from '../utils/sse';

const transformers: Record<string, Transformer> = {
  openai: openaiTransformer,
  anthropic: anthropicTransformer,
  gemini: geminiTransformer,
};

export { transformers, streamHeaders };

export type ProxyOutcome =
  | { type: 'json'; status: number; body: unknown }
  | { type: 'stream'; stream: ReadableStream<Uint8Array>; status: number }
  | { type: 'error'; status: number; body: unknown };

export async function proxyRequest(
  env: Env,
  keyId: string,
  userId: string,
  clientFormat: string,
  rawBody: unknown,
): Promise<ProxyOutcome> {
  const clientTransformer = transformers[clientFormat];
  if (!clientTransformer) {
    return { type: 'error', status: 400, body: { error: { message: `Unsupported client format: ${clientFormat}`, type: 'invalid_request' } } };
  }

  // Step 1: Decode client request to OpenAI intermediate format
  let openaiRequest: OpenAIRequest;
  try {
    openaiRequest = clientTransformer.decodeRequest(rawBody);
  } catch (e) {
    return { type: 'error', status: 400, body: { error: { message: `Invalid request body for format ${clientFormat}: ${e instanceof Error ? e.message : 'parse error'}`, type: 'invalid_request' } } };
  }

  if (!openaiRequest.model || !openaiRequest.messages || !Array.isArray(openaiRequest.messages)) {
    return { type: 'error', status: 400, body: { error: { message: 'model and messages are required', type: 'invalid_request' } } };
  }

  // Step 2: Route
  const route = await routeRequest(env, keyId, openaiRequest);
  if ('type' in route) {
    const errorStatus = route.type === 'context_too_long' ? 400 : 404;
    return { type: 'error', status: errorStatus, body: { error: { message: route.message, type: route.type, ...(route.extra || {}) } } };
  }

  const { endpoint, model } = route;
  const upstreamTransformer = transformers[endpoint.format];
  if (!upstreamTransformer) {
    return { type: 'error', status: 500, body: { error: { message: `Unsupported upstream format: ${endpoint.format}`, type: 'internal_error' } } };
  }

  // Step 3: Encode to upstream format
  const transformed = upstreamTransformer.encodeRequest(openaiRequest, model.real_model, endpoint.api_key);
  const fullUrl = endpoint.base_url.replace(/\/$/, '') + transformed.url;

  // Step 4: Forward to upstream
  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method: 'POST',
      headers: transformed.headers,
      body: transformed.body,
    });
  } catch {
    return { type: 'error', status: 502, body: { error: { message: 'Upstream timeout or connection error', type: 'gateway_error' } } };
  }

  const responseTimeMs = Date.now() - startTime;

  // Step 5: Transform response
  const isPassthrough = clientFormat === endpoint.format;

  if (openaiRequest.stream && response.body) {
    if (isPassthrough) {
      void recordStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status);
      return { type: 'stream', stream: response.body, status: response.status };
    }

    const upstreamEvents = parseSSEStream(response.body);
    const openaiEvents = upstreamTransformer.decodeStream(upstreamEvents, model.real_model);
    const clientEvents = clientTransformer.encodeStream(openaiEvents, model.real_model);
    const clientStream = serializeSSEStream(clientEvents);

    void recordStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status);
    return { type: 'stream', stream: clientStream, status: response.status };
  }

  // Non-streaming path
  const responseBody = await response.text();

  if (isPassthrough) {
    let parsedBody: unknown;
    try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = responseBody; }
    void recordNonStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status, parsedBody);
    return { type: 'json', status: response.status, body: parsedBody };
  }

  const { body: openaiBody, status } = upstreamTransformer.decodeResponse(responseBody, response.status);
  const { body: clientBody } = clientTransformer.encodeResponse(openaiBody, status);

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(clientBody); } catch { parsedBody = clientBody; }

  void recordNonStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, status, parsedBody);

  return { type: 'json', status, body: parsedBody };
}

async function recordNonStreamStats(env: Env, userId: string, keyId: string, modelName: string, responseTimeMs: number, statusCode: number, body: unknown): Promise<void> {
  let tokens = 0;
  if (typeof body === 'object' && body !== null) {
    const usage = (body as { usage?: { total_tokens?: number } }).usage;
    tokens = usage?.total_tokens || 0;
  }
  void recordStats(env, userId, keyId, modelName, { tokens, responseTimeMs, statusCode });
}

async function recordStreamStats(env: Env, userId: string, keyId: string, modelName: string, responseTimeMs: number, statusCode: number): Promise<void> {
  void recordStats(env, userId, keyId, modelName, { tokens: 0, responseTimeMs, statusCode });
}
