import { Hono } from 'hono';

export interface Env {
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
