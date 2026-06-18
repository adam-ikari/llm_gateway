import { Hono } from 'hono';
import type { Env } from '../index';
import { renderHTML } from './html';

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.get('/', (c) => c.html(renderHTML()));
adminRoutes.get('/*', (c) => c.html(renderHTML()));
