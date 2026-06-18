import type { Env } from '../index';
import type { OpenAIRequest, TransformedRequest } from '../types';
import type { Transformer } from '../transformer/types';
import { openaiTransformer } from '../transformer/openai';
import { anthropicTransformer } from '../transformer/anthropic';
import { geminiTransformer } from '../transformer/gemini';
import { routeRequest } from '../router/index';
import { recordStats } from './stats';

const transformers: Record<string, Transformer> = {
  openai: openaiTransformer,
  anthropic: anthropicTransformer,
  gemini: geminiTransformer,
};

export interface ProxyResult {
  status: number;
  body: string;
  tokens: number;
  responseTimeMs: number;
}

export async function proxyRequest(
  env: Env,
  keyId: string,
  userId: string,
  request: OpenAIRequest,
): Promise<{ result: ProxyResult; modelName: string } | { error: { status: number; body: string } }> {
  const route = await routeRequest(env, keyId, request);

  if ('type' in route) {
    const errorStatus = route.type === 'context_too_long' ? 400 : 404;
    return {
      error: {
        status: errorStatus,
        body: JSON.stringify({
          error: { message: route.message, type: route.type, ...(route.extra || {}) },
        }),
      },
    };
  }

  const { endpoint, model } = route;
  const transformer = transformers[endpoint.format];
  if (!transformer) {
    return {
      error: {
        status: 500,
        body: JSON.stringify({ error: { message: `Unsupported format: ${endpoint.format}`, type: 'internal_error' } }),
      },
    };
  }

  const transformed = transformer.transformRequest(request, model.real_model, endpoint.api_key);
  const fullUrl = endpoint.base_url.replace(/\/$/, '') + transformed.url;

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method: 'POST',
      headers: transformed.headers,
      body: transformed.body,
    });
  } catch {
    return {
      error: {
        status: 502,
        body: JSON.stringify({ error: { message: 'Upstream timeout or connection error', type: 'gateway_error' } }),
      },
    };
  }

  const responseTimeMs = Date.now() - startTime;
  const responseBody = await response.text();
  const { body: openaiBody, status } = transformer.transformResponse(responseBody, response.status);

  let tokens = 0;
  try {
    const parsed = JSON.parse(openaiBody);
    tokens = parsed.usage?.total_tokens || 0;
  } catch {}

  void recordStats(env, userId, keyId, request.model, { tokens, responseTimeMs, statusCode: status });

  return {
    result: { status, body: openaiBody, tokens, responseTimeMs },
    modelName: request.model,
  };
}
