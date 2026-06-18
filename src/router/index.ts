import type { Env } from '../index';
import type { Binding, Endpoint, EndpointModel, RouteResult, OpenAIRequest } from '../types';
import { kvGet } from '../utils/kv';
import { detectContentTypes } from './detector';
import { estimateTokens } from '../utils/tokens';

export interface RoutingError {
  type: 'no_binding' | 'context_too_long';
  message: string;
  extra?: Record<string, unknown>;
}

export async function routeRequest(
  env: Env,
  keyId: string,
  request: OpenAIRequest,
): Promise<RouteResult | RoutingError> {
  const detectedTypes = detectContentTypes(request.messages);

  const bindingIndex = await kvGet<{ model_name: string; endpoint_id: string }[]>(
    env,
    `binding_index/${keyId}`,
  );
  if (!bindingIndex || bindingIndex.length === 0) {
    return { type: 'no_binding', message: 'No endpoints configured for key' };
  }

  const candidates: { binding: Binding; endpoint: Endpoint; model: EndpointModel }[] = [];

  for (const entry of bindingIndex) {
    if (entry.model_name !== request.model) continue;

    const binding = await kvGet<Binding>(env, `bindings/${keyId}:${entry.model_name}`);
    if (!binding) continue;

    const coversAll = [...detectedTypes].every((dt) => binding.request_types.includes(dt));
    if (!coversAll) continue;

    const endpoint = await kvGet<Endpoint>(env, `endpoints/${binding.endpoint_id}`);
    if (!endpoint) continue;

    const model = endpoint.supported_models.find((m) => m.name === request.model);
    if (!model) continue;

    candidates.push({ binding, endpoint, model });
  }

  if (candidates.length === 0) {
    return {
      type: 'no_binding',
      message: `No endpoint configured for model "${request.model}" with content types [${[...detectedTypes].join(', ')}]`,
    };
  }

  candidates.sort((a, b) => a.binding.priority - b.binding.priority);

  const requestTokens = estimateTokens(request);
  const fitting = candidates.filter((c) => c.model.context_window > requestTokens);

  if (fitting.length === 0) {
    return {
      type: 'context_too_long',
      message: 'Request exceeds context window for all matching endpoints',
      extra: {
        request_tokens: requestTokens,
        max_context: Math.max(...candidates.map((c) => c.model.context_window)),
      },
    };
  }

  return { endpoint: fitting[0].endpoint, model: fitting[0].model };
}
