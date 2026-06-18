import { Hono } from 'hono';
import type { Env } from '../index';
import { PRESET_MODELS } from '../data/presets';
import { jsonOk } from '../utils/response';

const modelRoutes = new Hono<{ Bindings: Env }>();

modelRoutes.get('/', (c) => jsonOk(c, { data: PRESET_MODELS }));

export { modelRoutes };
