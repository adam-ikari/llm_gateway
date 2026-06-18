import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { proxyRequest, streamHeaders } from '../services/proxy';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type ProxyHono = Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>;

// Backward-compatible route: /v1/chat/completions (OpenAI format)
const proxyRoutes: ProxyHono = new Hono();
proxyRoutes.use('*', authMiddleware);
proxyRoutes.post('/chat/completions', handleProxy('openai'));

// OpenAI format: /v1/openai/chat/completions
const openaiProxyRoutes: ProxyHono = new Hono();
openaiProxyRoutes.use('*', authMiddleware);
openaiProxyRoutes.post('/chat/completions', handleProxy('openai'));

// Anthropic format: /v1/anthropic/messages
const anthropicProxyRoutes: ProxyHono = new Hono();
anthropicProxyRoutes.use('*', authMiddleware);
anthropicProxyRoutes.post('/messages', handleProxy('anthropic'));

// Gemini format: /v1/gemini/models/:model:generateContent
const geminiProxyRoutes: ProxyHono = new Hono();
geminiProxyRoutes.use('*', authMiddleware);
// Non-streaming
geminiProxyRoutes.post('/models/:model\\:generateContent', handleGeminiProxy(false));
// Streaming
geminiProxyRoutes.post('/models/:model\\:streamGenerateContent', handleGeminiProxy(true));

function handleProxy(clientFormat: string) {
  return async (c: any) => {
    const rawBody = await c.req.json();
    const auth = c.get('auth') as AuthContext;
    const outcome = await proxyRequest(c.env as Env, auth.key_id, auth.user_id, clientFormat, rawBody);

    switch (outcome.type) {
      case 'error':
        return c.json(outcome.body, outcome.status as ContentfulStatusCode);
      case 'json':
        return c.json(outcome.body, outcome.status as ContentfulStatusCode);
      case 'stream':
        return new Response(outcome.stream, {
          status: outcome.status,
          headers: streamHeaders(),
        });
    }
  };
}

function handleGeminiProxy(isStreaming: boolean) {
  return async (c: any) => {
    const rawBody = await c.req.json();
    // Inject model from URL path param and stream flag into body
    // so geminiTransformer.decodeRequest can read them
    rawBody._model = c.req.param('model');
    rawBody._stream = isStreaming;
    const auth = c.get('auth') as AuthContext;
    const outcome = await proxyRequest(c.env as Env, auth.key_id, auth.user_id, 'gemini', rawBody);

    switch (outcome.type) {
      case 'error':
        return c.json(outcome.body, outcome.status as ContentfulStatusCode);
      case 'json':
        return c.json(outcome.body, outcome.status as ContentfulStatusCode);
      case 'stream':
        return new Response(outcome.stream, {
          status: outcome.status,
          headers: streamHeaders(),
        });
    }
  };
}

export { proxyRoutes, openaiProxyRoutes, anthropicProxyRoutes, geminiProxyRoutes };
