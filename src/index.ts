import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { keyRoutes } from './routes/keys';
import { endpointRoutes } from './routes/endpoints';
import { bindingRoutes } from './routes/bindings';
import { modelRoutes } from './routes/models';
import { proxyRoutes, openaiProxyRoutes, anthropicProxyRoutes, geminiProxyRoutes } from './routes/proxy';
import { statsRoutes } from './routes/stats';
import { billingRoutes } from './routes/billing';

export interface Env {
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// API routes
app.route('/v1/auth', authRoutes);
app.route('/v1/keys', keyRoutes);
app.route('/v1/keys', bindingRoutes);
app.route('/v1/endpoints', endpointRoutes);
app.route('/v1/endpoints', billingRoutes);
app.route('/v1/models', modelRoutes);
app.route('/v1', proxyRoutes);            // /v1/chat/completions (backward compatible)
app.route('/v1/openai', openaiProxyRoutes);
app.route('/v1/anthropic', anthropicProxyRoutes);
app.route('/v1/gemini', geminiProxyRoutes);
app.route('/v1/stats', statsRoutes);

// 404 catch-all
app.all('*', (c) => c.json({ error: { message: 'Not found', type: 'not_found' } }, 404));

export default app;
