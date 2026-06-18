# LLM Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-tenant LLM API gateway on Cloudflare Workers + KV with user management, model endpoint routing, format conversion, smart content-type routing, context window validation, usage statistics, and provider balance queries.

**Architecture:** Single Cloudflare Worker using the Hono framework. KV store for all persistent data. Modular design with routes → services → KV helpers. Transformers handle OpenAI/Anthropic/Gemini format conversion. Pluggable billing handlers for provider balance queries. Smart router detects request content type and validates context window before forwarding.

**Tech Stack:** Cloudflare Workers, KV, TypeScript, Hono, Web Crypto API, Wrangler CLI

---

## File Structure

```
llm_gateway/
├── src/
│   ├── index.ts                  # Worker entry, Hono app + route registration
│   ├── types.ts                  # All TypeScript interfaces and types
│   ├── middleware/
│   │   └── auth.ts               # Bearer token auth middleware
│   ├── routes/
│   │   ├── auth.ts               # POST /v1/auth/register, /v1/auth/login
│   │   ├── keys.ts               # CRUD /v1/keys
│   │   ├── endpoints.ts          # CRUD /v1/endpoints
│   │   ├── bindings.ts           # PUT/GET /v1/keys/:key_id/bindings
│   │   ├── models.ts             # GET /v1/models
│   │   ├── proxy.ts              # POST /v1/chat/completions
│   │   ├── stats.ts              # GET /v1/stats/*
│   │   └── billing.ts            # GET /v1/endpoints/*/balance
│   ├── services/
│   │   ├── auth.ts               # User registration/login logic
│   │   ├── key.ts                # API key generation/management
│   │   ├── endpoint.ts           # Endpoint CRUD logic
│   │   ├── binding.ts            # Binding management logic
│   │   ├── proxy.ts              # Proxy orchestration
│   │   └── stats.ts              # Stats recording and queries
│   ├── transformer/
│   │   ├── types.ts              # Transformer interface
│   │   ├── openai.ts             # OpenAI passthrough
│   │   ├── anthropic.ts          # OpenAI ↔ Anthropic
│   │   └── gemini.ts             # OpenAI ↔ Gemini
│   ├── billing/
│   │   ├── types.ts              # BillingHandler interface + BalanceResult
│   │   ├── registry.ts           # Handler registry (Map)
│   │   ├── openai.ts             # OpenAI balance query
│   │   ├── anthropic.ts          # Anthropic balance query
│   │   ├── deepseek.ts           # DeepSeek balance query
│   │   ├── moonshot.ts           # Moonshot balance query
│   │   ├── zhipu.ts              # Zhipu balance query
│   │   └── aliyun.ts             # Aliyun balance query
│   ├── router/
│   │   ├── detector.ts           # Content type detection
│   │   └── index.ts              # Routing engine
│   ├── utils/
│   │   ├── crypto.ts             # Password hashing, key generation
│   │   ├── kv.ts                 # KV helpers (get/put/delete, index management)
│   │   ├── tokens.ts             # Token estimation
│   │   └── response.ts           # JSON response helpers
│   └── data/
│       └── presets.ts            # Preset virtual models
├── wrangler.toml
├── package.json
└── tsconfig.json
```

### Task Dependency Order

```
Task 1 (project setup) → Task 2 (types) → Task 3 (kv utils) → Task 4 (crypto utils)
→ Task 5 (response utils) → Task 6 (presets) → Task 7 (auth service + route)
→ Task 8 (key service + route) → Task 9 (endpoint service + route)
→ Task 10 (binding service + route) → Task 11 (models route)
→ Task 12 (transformers) → Task 13 (router) → Task 14 (proxy service + route)
→ Task 15 (stats service + route) → Task 16 (billing) → Task 17 (token estimation)
→ Task 18 (index.ts wiring)
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts` (minimal Hono app with health check)

- [ ] **Step 1: Initialize package.json**

```bash
cd /home/gem/project/llm_gateway && npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install hono
npm install -D @cloudflare/workers-types typescript wrangler
```

- [ ] **Step 3: Write package.json with correct config**

```json
{
  "name": "llm-gateway",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0",
    "wrangler": "^3.0.0"
  }
}
```

Note: After editing, run `npm install` to update lockfile.

- [ ] **Step 4: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Write wrangler.toml**

```toml
name = "llm-gateway"
compatibility_date = "2026-06-18"
main = "src/index.ts"

[[kv_namespaces]]
binding = "KV"
id = "PLACEHOLDER"
preview_id = "PLACEHOLDER"
```

- [ ] **Step 6: Write minimal src/index.ts**

```typescript
import { Hono } from 'hono';

export interface Env {
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
```

- [ ] **Step 7: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml src/index.ts
git commit -m "feat: scaffold project with Hono + Cloudflare Workers + KV"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write src/types.ts**

```typescript
// ========== User ==========

export interface User {
  user_id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

// ========== API Key ==========

export interface ApiKey {
  key_id: string;
  user_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  is_active: boolean;
  created_at: number;
}

// ========== Endpoint ==========

export interface EndpointModel {
  name: string;
  real_model: string;
  context_window: number;
  max_output_tokens: number;
}

export interface Endpoint {
  endpoint_id: string;
  user_id: string;
  name: string;
  base_url: string;
  api_key: string;
  format: 'openai' | 'anthropic' | 'gemini';
  supported_models: EndpointModel[];
  created_at: number;
  updated_at: number;
}

// ========== Binding ==========

export interface Binding {
  key_id: string;
  model_name: string;
  endpoint_id: string;
  priority: number;
  request_types: string[];
}

// ========== Model Preset ==========

export interface ModelCapabilities {
  text: boolean;
  image: boolean;
  audio: boolean;
  video: boolean;
  file: boolean;
}

export interface ModelPreset {
  name: string;
  display_name: string;
  description: string;
  capabilities: ModelCapabilities;
  context_window: number;
  max_output_tokens: number;
  default_format: 'openai' | 'anthropic' | 'gemini';
}

// ========== Stats ==========

export interface StatsByEntity {
  requests: number;
  tokens: number;
  avg_response_time_ms: number;
  status_codes: Record<string, number>;
}

export interface Stats {
  total_requests: number;
  total_tokens: number;
  avg_response_time_ms: number;
  status_codes: Record<string, number>;
  by_key: Record<string, StatsByEntity>;
  by_model: Record<string, StatsByEntity>;
}

// ========== OpenAI-compatible types ==========

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[];
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: OpenAIToolDef[];
  tool_choice?: string | { type: string; function?: { name: string } };
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage: OpenAIUsage;
}

// ========== Proxy ==========

export interface TransformedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface RouteResult {
  endpoint: Endpoint;
  model: EndpointModel;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add all TypeScript type definitions"
```

---

### Task 3: KV Utility Helpers

**Files:**
- Create: `src/utils/kv.ts`

- [ ] **Step 1: Write src/utils/kv.ts**

```typescript
import type { Env } from '../index';

export async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  const raw = await env.KV.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvPut<T>(env: Env, key: string, value: T): Promise<void> {
  await env.KV.put(key, JSON.stringify(value));
}

export async function kvDelete(env: Env, key: string): Promise<void> {
  await env.KV.delete(key);
}

// ========== Index helpers (KV doesn't support list operations) ==========

export async function indexAdd<T>(env: Env, indexKey: string, item: T): Promise<void> {
  const current = await kvGet<T[]>(env, indexKey) || [];
  current.push(item);
  await kvPut(env, indexKey, current);
}

export async function indexRemove<T>(
  env: Env,
  indexKey: string,
  predicate: (item: T) => boolean,
): Promise<void> {
  const current = await kvGet<T[]>(env, indexKey) || [];
  await kvPut(env, indexKey, current.filter((item) => !predicate(item)));
}

export async function indexList<T>(env: Env, indexKey: string): Promise<T[]> {
  return (await kvGet<T[]>(env, indexKey)) || [];
}

export function generateId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${random}`;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors (may warn about crypto — Workers runtime provides it).

- [ ] **Step 3: Commit**

```bash
git add src/utils/kv.ts
git commit -m "feat: add KV utility helpers with index support"
```

---

### Task 4: Crypto Utilities

**Files:**
- Create: `src/utils/crypto.ts`

- [ ] **Step 1: Write src/utils/crypto.ts**

```typescript
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  const hash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${saltHex}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hash] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key,
    256,
  );
  const computedHash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHash === hash;
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(apiKey));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateApiKey(): { full: string; prefix: string } {
  const random = crypto.randomUUID().replace(/-/g, '');
  const full = `sk-${random}`;
  const prefix = full.slice(0, 11); // "sk-" + 8 chars
  return { full, prefix };
}

export function sha256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(input)).then((hash) =>
    Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/crypto.ts
git commit -m "feat: add crypto utilities (password hashing, API key generation)"
```

---

### Task 5: Response Utilities + Auth Middleware

**Files:**
- Create: `src/utils/response.ts`
- Create: `src/middleware/auth.ts`

- [ ] **Step 1: Write src/utils/response.ts**

```typescript
import type { Context } from 'hono';

export function jsonOk(c: Context, data: unknown, status = 200): Response {
  return c.json(data, status);
}

export function jsonError(
  c: Context,
  status: number,
  message: string,
  type: string,
  extra: Record<string, unknown> = {},
): Response {
  return c.json(
    { error: { message, type, ...extra } },
    status,
  );
}

export function authError(c: Context, message = 'Invalid API key'): Response {
  return jsonError(c, 401, message, 'auth_error');
}

export function notFoundError(c: Context, message: string): Response {
  return jsonError(c, 404, message, 'not_found');
}

export function badRequestError(c: Context, message: string, extra: Record<string, unknown> = {}): Response {
  return jsonError(c, 400, message, 'invalid_request', extra);
}
```

- [ ] **Step 2: Write src/middleware/auth.ts**

```typescript
import type { Context, Next } from 'hono';
import type { Env } from '../index';
import type { ApiKey } from '../types';
import { kvGet } from '../utils/kv';
import { hashApiKey } from '../utils/crypto';
import { authError } from '../utils/response';

export interface AuthContext {
  key_id: string;
  user_id: string;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return authError(c, 'Missing or invalid Authorization header');
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey.startsWith('sk-') || apiKey.length < 20) {
    return authError(c, 'Invalid API key format');
  }

  const keyHash = await hashApiKey(apiKey);
  const prefix = apiKey.slice(0, 11);

  // Scan by prefix to find matching key (iterate through key_index)
  // We look up the user's key index to find candidate keys
  // Since KV has no native scan, we check key_index of all users
  // But we don't know the user yet — so we use the prefix to narrow
  // For simplicity, we look up by a prefix index
  const candidates = await kvGet<string[]>(c.env, `key_prefix_index:${prefix}`) || [];

  for (const keyId of candidates) {
    const keyData = await kvGet<ApiKey>(c.env, `keys/${keyId}`);
    if (keyData && keyData.key_hash === keyHash && keyData.is_active) {
      c.set('auth', { key_id: keyData.key_id, user_id: keyData.user_id } as AuthContext);
      return next();
    }
  }

  return authError(c, 'Invalid API key');
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors (may warn about `c.set` — Hono supports it).

- [ ] **Step 4: Commit**

```bash
git add src/utils/response.ts src/middleware/auth.ts
git commit -m "feat: add response helpers and Bearer token auth middleware"
```

---

### Task 6: Model Presets

**Files:**
- Create: `src/data/presets.ts`

- [ ] **Step 1: Write src/data/presets.ts**

```typescript
import type { ModelPreset } from '../types';

export const PRESET_MODELS: ModelPreset[] = [
  {
    name: 'gpt-4o-mini',
    display_name: 'GPT-4o Mini',
    description: 'OpenAI GPT-4o Mini — fast, affordable text model',
    capabilities: { text: true, image: false, audio: false, video: false, file: false },
    context_window: 128000,
    max_output_tokens: 16384,
    default_format: 'openai',
  },
  {
    name: 'gpt-4o',
    display_name: 'GPT-4o',
    description: 'OpenAI GPT-4o — multimodal flagship model',
    capabilities: { text: true, image: true, audio: false, video: false, file: false },
    context_window: 128000,
    max_output_tokens: 16384,
    default_format: 'openai',
  },
  {
    name: 'claude-haiku',
    display_name: 'Claude Haiku 4.5',
    description: 'Anthropic Claude Haiku — fast text model',
    capabilities: { text: true, image: false, audio: false, video: false, file: false },
    context_window: 200000,
    max_output_tokens: 64000,
    default_format: 'anthropic',
  },
  {
    name: 'claude-sonnet',
    display_name: 'Claude Sonnet 4.6',
    description: 'Anthropic Claude Sonnet — balanced speed and power, text + image',
    capabilities: { text: true, image: true, audio: false, video: false, file: false },
    context_window: 1000000,
    max_output_tokens: 64000,
    default_format: 'anthropic',
  },
  {
    name: 'claude-opus',
    display_name: 'Claude Opus 4.8',
    description: 'Anthropic Claude Opus — most capable model, text + image',
    capabilities: { text: true, image: true, audio: false, video: false, file: false },
    context_window: 1000000,
    max_output_tokens: 128000,
    default_format: 'anthropic',
  },
  {
    name: 'gemini-pro',
    display_name: 'Gemini Pro',
    description: 'Google Gemini Pro — text model',
    capabilities: { text: true, image: false, audio: false, video: false, file: false },
    context_window: 1000000,
    max_output_tokens: 8192,
    default_format: 'gemini',
  },
  {
    name: 'gemini-pro-vision',
    display_name: 'Gemini Pro Vision',
    description: 'Google Gemini Pro Vision — multimodal model',
    capabilities: { text: true, image: true, audio: false, video: false, file: false },
    context_window: 1000000,
    max_output_tokens: 8192,
    default_format: 'gemini',
  },
];
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/presets.ts
git commit -m "feat: add preset virtual models"
```

---

### Task 7: Auth Service + Routes

**Files:**
- Create: `src/services/auth.ts`
- Create: `src/routes/auth.ts`

- [ ] **Step 1: Write src/services/auth.ts**

```typescript
import type { Env } from '../index';
import type { User } from '../types';
import { kvGet, kvPut, generateId } from '../utils/kv';
import { hashPassword, verifyPassword, generateApiKey, hashApiKey, sha256Hash } from '../utils/crypto';
import { indexAdd } from '../utils/kv';

export interface RegisterInput {
  email: string;
  password: string;
}

export interface RegisterResult {
  user_id: string;
  api_key: string;
  email: string;
}

export async function registerUser(env: Env, input: RegisterInput): Promise<RegisterResult> {
  // Check if email already exists
  const emailHash = await sha256Hash(input.email.toLowerCase());
  const existingUserId = await kvGet<string>(env, `email_index/${emailHash}`);
  if (existingUserId) {
    throw new AuthError('Email already registered');
  }

  const userId = generateId('usr');
  const passwordHash = await hashPassword(input.password);

  const user: User = {
    user_id: userId,
    email: input.email.toLowerCase(),
    password_hash: passwordHash,
    created_at: Date.now(),
  };

  await kvPut(env, `users/${userId}`, user);
  await kvPut(env, `email_index/${emailHash}`, userId);

  // Create initial API key
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name: 'Default',
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return { user_id: userId, api_key: full, email: user.email };
}

export async function loginUser(env: Env, input: RegisterInput): Promise<RegisterResult> {
  const emailHash = await sha256Hash(input.email.toLowerCase());
  const userId = await kvGet<string>(env, `email_index/${emailHash}`);
  if (!userId) {
    throw new AuthError('Invalid email or password');
  }

  const user = await kvGet<User>(env, `users/${userId}`);
  if (!user) {
    throw new AuthError('Invalid email or password');
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    throw new AuthError('Invalid email or password');
  }

  // Create a new API key for this session
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name: 'Login session',
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return { user_id: userId, api_key: full, email: user.email };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 2: Write src/routes/auth.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import { registerUser, loginUser, AuthError } from '../services/auth';
import { jsonOk, jsonError, badRequestError } from '../utils/response';

const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/register', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    return badRequestError(c, 'Email and password are required');
  }
  if (body.password.length < 8) {
    return badRequestError(c, 'Password must be at least 8 characters');
  }

  try {
    const result = await registerUser(c.env, body);
    return jsonOk(c, result, 201);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(c, 409, e.message, 'conflict');
    }
    throw e;
  }
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    return badRequestError(c, 'Email and password are required');
  }

  try {
    const result = await loginUser(c.env, body);
    return jsonOk(c, result);
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError(c, 401, e.message, 'auth_error');
    }
    throw e;
  }
});

export { authRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/auth.ts src/routes/auth.ts
git commit -m "feat: add user registration and login with API key generation"
```

---

### Task 8: Key Service + Routes

**Files:**
- Create: `src/services/key.ts`
- Create: `src/routes/keys.ts`

- [ ] **Step 1: Write src/services/key.ts**

```typescript
import type { Env } from '../index';
import type { ApiKey } from '../types';
import { kvGet, kvPut, kvDelete, generateId, indexAdd, indexRemove, indexList } from '../utils/kv';
import { generateApiKey, hashApiKey } from '../utils/crypto';

export interface KeyCreateResult {
  key_id: string;
  api_key: string;
  name: string;
  key_prefix: string;
  created_at: number;
}

export async function createKey(env: Env, userId: string, name: string): Promise<KeyCreateResult> {
  const { full, prefix } = generateApiKey();
  const keyHash = await hashApiKey(full);
  const keyId = generateId('key');

  const keyData: ApiKey = {
    key_id: keyId,
    user_id: userId,
    key_hash: keyHash,
    key_prefix: prefix,
    name,
    is_active: true,
    created_at: Date.now(),
  };

  await kvPut(env, `keys/${keyId}`, keyData);
  await indexAdd(env, `key_index/${userId}`, keyId);
  await indexAdd(env, `key_prefix_index/${prefix}`, keyId);

  return {
    key_id: keyId,
    api_key: full,
    name,
    key_prefix: prefix,
    created_at: keyData.created_at,
  };
}

export async function listKeys(env: Env, userId: string): Promise<ApiKey[]> {
  const keyIds = await indexList<string>(env, `key_index/${userId}`);
  const keys: ApiKey[] = [];
  for (const keyId of keyIds) {
    const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
    if (key) keys.push(key);
  }
  return keys;
}

export async function getKey(env: Env, userId: string, keyId: string): Promise<ApiKey | null> {
  const key = await kvGet<ApiKey>(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) return null;
  return key;
}

export async function updateKey(
  env: Env,
  userId: string,
  keyId: string,
  updates: { name?: string; is_active?: boolean },
): Promise<ApiKey | null> {
  const key = await getKey(env, userId, keyId);
  if (!key) return null;

  if (updates.name !== undefined) key.name = updates.name;
  if (updates.is_active !== undefined) key.is_active = updates.is_active;

  await kvPut(env, `keys/${keyId}`, key);
  return key;
}

export async function deleteKey(env: Env, userId: string, keyId: string): Promise<boolean> {
  const key = await getKey(env, userId, keyId);
  if (!key) return false;

  await kvDelete(env, `keys/${keyId}`);
  await kvDelete(env, `bindings_index/${keyId}`);
  await indexRemove(env, `key_index/${userId}`, (id: string) => id === keyId);
  await indexRemove(env, `key_prefix_index/${key.key_prefix}`, (id: string) => id === keyId);

  return true;
}

export { type ApiKey };
```

- [ ] **Step 2: Write src/routes/keys.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as keyService from '../services/key';
import { jsonOk, badRequestError, notFoundError } from '../utils/response';

const keyRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

keyRoutes.use('*', authMiddleware);

keyRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name: string }>();
  if (!body.name) {
    return badRequestError(c, 'Key name is required');
  }

  const auth = c.get('auth');
  const result = await keyService.createKey(c.env, auth.user_id, body.name);
  return jsonOk(c, result, 201);
});

keyRoutes.get('/', async (c) => {
  const auth = c.get('auth');
  const keys = await keyService.listKeys(c.env, auth.user_id);
  return jsonOk(c, keys.map((k) => ({
    key_id: k.key_id,
    name: k.name,
    key_prefix: k.key_prefix,
    is_active: k.is_active,
    created_at: k.created_at,
  })));
});

keyRoutes.get('/:key_id', async (c) => {
  const auth = c.get('auth');
  const key = await keyService.getKey(c.env, auth.user_id, c.req.param('key_id'));
  if (!key) return notFoundError(c, 'Key not found');
  return jsonOk(c, {
    key_id: key.key_id,
    name: key.name,
    key_prefix: key.key_prefix,
    is_active: key.is_active,
    created_at: key.created_at,
  });
});

keyRoutes.patch('/:key_id', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{ name?: string; is_active?: boolean }>();
  const key = await keyService.updateKey(c.env, auth.user_id, c.req.param('key_id'), body);
  if (!key) return notFoundError(c, 'Key not found');
  return jsonOk(c, {
    key_id: key.key_id,
    name: key.name,
    key_prefix: key.key_prefix,
    is_active: key.is_active,
    created_at: key.created_at,
  });
});

keyRoutes.delete('/:key_id', async (c) => {
  const auth = c.get('auth');
  const deleted = await keyService.deleteKey(c.env, auth.user_id, c.req.param('key_id'));
  if (!deleted) return notFoundError(c, 'Key not found');
  return jsonOk(c, { deleted: true });
});

export { keyRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/key.ts src/routes/keys.ts
git commit -m "feat: add API key management CRUD"
```

---

### Task 9: Endpoint Service + Routes

**Files:**
- Create: `src/services/endpoint.ts`
- Create: `src/routes/endpoints.ts`

- [ ] **Step 1: Write src/services/endpoint.ts**

```typescript
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
```

- [ ] **Step 2: Write src/routes/endpoints.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as endpointService from '../services/endpoint';
import { jsonOk, badRequestError, notFoundError } from '../utils/response';

const VALID_FORMATS = ['openai', 'anthropic', 'gemini'];

const endpointRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

endpointRoutes.use('*', authMiddleware);

endpointRoutes.post('/', async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.base_url || !body.api_key || !body.format || !body.supported_models) {
    return badRequestError(c, 'name, base_url, api_key, format, and supported_models are required');
  }
  if (!VALID_FORMATS.includes(body.format)) {
    return badRequestError(c, `format must be one of: ${VALID_FORMATS.join(', ')}`);
  }
  if (!Array.isArray(body.supported_models) || body.supported_models.length === 0) {
    return badRequestError(c, 'supported_models must be a non-empty array');
  }
  for (const m of body.supported_models) {
    if (!m.name || !m.real_model || !m.context_window) {
      return badRequestError(c, 'Each model must have name, real_model, and context_window');
    }
  }

  const endpoint = await endpointService.createEndpoint(c.env, c.get('auth').user_id, body);
  return jsonOk(c, endpoint, 201);
});

endpointRoutes.get('/', async (c) => {
  const endpoints = await endpointService.listEndpoints(c.env, c.get('auth').user_id);
  return jsonOk(c, endpoints);
});

endpointRoutes.get('/:endpoint_id', async (c) => {
  const ep = await endpointService.getEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'));
  if (!ep) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, ep);
});

endpointRoutes.put('/:endpoint_id', async (c) => {
  const body = await c.req.json();
  if (body.format && !VALID_FORMATS.includes(body.format)) {
    return badRequestError(c, `format must be one of: ${VALID_FORMATS.join(', ')}`);
  }

  const ep = await endpointService.updateEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'), body);
  if (!ep) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, ep);
});

endpointRoutes.delete('/:endpoint_id', async (c) => {
  const deleted = await endpointService.deleteEndpoint(c.env, c.get('auth').user_id, c.req.param('endpoint_id'));
  if (!deleted) return notFoundError(c, 'Endpoint not found');
  return jsonOk(c, { deleted: true });
});

export { endpointRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/endpoint.ts src/routes/endpoints.ts
git commit -m "feat: add endpoint CRUD with model + context window config"
```

---

### Task 10: Binding Service + Routes

**Files:**
- Create: `src/services/binding.ts`
- Create: `src/routes/bindings.ts`

- [ ] **Step 1: Write src/services/binding.ts**

```typescript
import type { Env } from '../index';
import type { Binding } from '../types';
import { kvPut, kvGet, kvDelete } from '../utils/kv';

const BINDING_KEY_PREFIX = 'bindings';

function bindingKey(keyId: string, modelName: string): string {
  return `${BINDING_KEY_PREFIX}/${keyId}:${modelName}`;
}

async function bindingIndexKey(keyId: string): Promise<string> {
  return `binding_index/${keyId}`;
}

export async function setBindings(
  env: Env,
  userId: string,
  keyId: string,
  bindings: Omit<Binding, 'key_id'>[],
): Promise<Binding[]> {
  // Verify key belongs to user
  const key = await kvGet(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) {
    throw new Error('Key not found');
  }

  // Get existing bindings for this key to clean up
  const existingIndex = await kvGet<{ model_name: string; endpoint_id: string }[]>(env, `binding_index/${keyId}`) || [];
  for (const existing of existingIndex) {
    await kvDelete(env, bindingKey(keyId, existing.model_name));
  }

  // Write new bindings
  const fullBindings: Binding[] = [];
  const newIndex: { model_name: string; endpoint_id: string }[] = [];

  for (const b of bindings) {
    const binding: Binding = {
      key_id: keyId,
      model_name: b.model_name,
      endpoint_id: b.endpoint_id,
      priority: b.priority ?? 0,
      request_types: b.request_types ?? ['text'],
    };
    await kvPut(env, bindingKey(keyId, b.model_name), binding);
    fullBindings.push(binding);
    newIndex.push({ model_name: b.model_name, endpoint_id: b.endpoint_id });
  }

  await kvPut(env, `binding_index/${keyId}`, newIndex);
  return fullBindings;
}

export async function getBindings(
  env: Env,
  userId: string,
  keyId: string,
): Promise<Binding[]> {
  const key = await kvGet(env, `keys/${keyId}`);
  if (!key || key.user_id !== userId) {
    throw new Error('Key not found');
  }

  const index = await kvGet<{ model_name: string; endpoint_id: string }[]>(env, `binding_index/${keyId}`) || [];
  const bindings: Binding[] = [];
  for (const entry of index) {
    const binding = await kvGet<Binding>(env, bindingKey(keyId, entry.model_name));
    if (binding) bindings.push(binding);
  }
  return bindings;
}

export async function getBindingForModel(
  env: Env,
  keyId: string,
  modelName: string,
): Promise<Binding | null> {
  return kvGet<Binding>(env, bindingKey(keyId, modelName));
}
```

- [ ] **Step 2: Write src/routes/bindings.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import * as bindingService from '../services/binding';
import { jsonOk, badRequestError, jsonError } from '../utils/response';

const bindingRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

bindingRoutes.use('*', authMiddleware);

bindingRoutes.put('/:key_id/bindings', async (c) => {
  const body = await c.req.json<{ bindings: Array<{ model_name: string; endpoint_id: string; request_types?: string[]; priority?: number }> }>();
  if (!body.bindings || !Array.isArray(body.bindings)) {
    return badRequestError(c, 'bindings array is required');
  }

  try {
    const result = await bindingService.setBindings(
      c.env,
      c.get('auth').user_id,
      c.req.param('key_id'),
      body.bindings,
    );
    return jsonOk(c, { bindings: result });
  } catch (e) {
    if (e instanceof Error && e.message === 'Key not found') {
      return jsonError(c, 404, 'Key not found', 'not_found');
    }
    throw e;
  }
});

bindingRoutes.get('/:key_id/bindings', async (c) => {
  try {
    const bindings = await bindingService.getBindings(
      c.env,
      c.get('auth').user_id,
      c.req.param('key_id'),
    );
    return jsonOk(c, { bindings });
  } catch (e) {
    if (e instanceof Error && e.message === 'Key not found') {
      return jsonError(c, 404, 'Key not found', 'not_found');
    }
    throw e;
  }
});

export { bindingRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/binding.ts src/routes/bindings.ts
git commit -m "feat: add key-endpoint binding management (full replace)"
```

---

### Task 11: Models Route

**Files:**
- Create: `src/routes/models.ts`

- [ ] **Step 1: Write src/routes/models.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import { PRESET_MODELS } from '../data/presets';
import { jsonOk } from '../utils/response';

const modelRoutes = new Hono<{ Bindings: Env }>();

modelRoutes.get('/', (c) => jsonOk(c, { data: PRESET_MODELS }));

export { modelRoutes };
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/models.ts
git commit -m "feat: add GET /v1/models listing preset virtual models"
```

---

### Task 12: Format Transformers

**Files:**
- Create: `src/transformer/types.ts`
- Create: `src/transformer/openai.ts`
- Create: `src/transformer/anthropic.ts`
- Create: `src/transformer/gemini.ts`

- [ ] **Step 1: Write src/transformer/types.ts**

```typescript
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export interface Transformer {
  format: string;
  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest;
  transformResponse(body: string, status: number): { body: string; status: number };
}
```

- [ ] **Step 2: Write src/transformer/openai.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export const openaiTransformer: Transformer = {
  format: 'openai',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const body = {
      ...req,
      model: realModel,
    };
    return {
      url: '', // base_url will be appended by caller
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
  },

  transformResponse(body: string, status: number): { body: string; status: number } {
    return { body, status };
  },
};
```

- [ ] **Step 3: Write src/transformer/anthropic.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export const anthropicTransformer: Transformer = {
  format: 'anthropic',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const systemMessages: string[] = [];
    const messages: Array<{ role: string; content: unknown }> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        systemMessages.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        continue;
      }

      // Convert OpenAI format to Anthropic format
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const anthropicContent: Array<Record<string, unknown>> = [];
        for (const part of msg.content) {
          if (part.type === 'text') {
            anthropicContent.push({ type: 'text', text: part.text });
          } else if (part.type === 'image_url') {
            anthropicContent.push({
              type: 'image',
              source: {
                type: 'url',
                url: part.image_url.url,
              },
            });
          }
        }
        messages.push({ role: msg.role, content: anthropicContent });
      }
    }

    const body: Record<string, unknown> = {
      model: realModel,
      max_tokens: req.max_tokens ?? 4096,
      messages,
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.join('\n');
    }

    if (req.stream !== undefined) {
      body.stream = req.stream;
    }

    return {
      url: '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    };
  },

  transformResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const anthropicResp = JSON.parse(body);
      const usage = anthropicResp.usage || {};

      const openaiResp: OpenAIResponse = {
        id: anthropicResp.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: anthropicResp.model || '',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: extractText(anthropicResp.content),
            },
            finish_reason: mapStopReason(anthropicResp.stop_reason),
          },
        ],
        usage: {
          prompt_tokens: usage.input_tokens || 0,
          completion_tokens: usage.output_tokens || 0,
          total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        },
      };

      return { body: JSON.stringify(openaiResp), status: 200 };
    } catch {
      return { body, status };
    }
  },
};

function extractText(content: Array<{ type: string; text?: string }>): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text || '')
    .join('\n');
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    default: return reason || 'stop';
  }
}
```

- [ ] **Step 4: Write src/transformer/gemini.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export const geminiTransformer: Transformer = {
  format: 'gemini',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const systemInstructions: string[] = [];
    const contents: Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        systemInstructions.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        continue;
      }

      const parts: Array<Record<string, unknown>> = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            // If URL starts with data:, extract base64
            if (part.image_url.url.startsWith('data:')) {
              const [mimePart, data] = part.image_url.url.split(';base64,');
              const mimeType = mimePart.replace('data:', '');
              parts.push({
                inline_data: {
                  mime_type: mimeType,
                  data,
                },
              });
            }
          }
        }
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts });
    }

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: req.max_tokens ?? 4096,
      },
    };

    if (systemInstructions.length > 0) {
      body.systemInstruction = { parts: [{ text: systemInstructions.join('\n') }] };
    }

    const url = `/v1beta/models/${realModel}:generateContent`;

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    };
  },

  transformResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const geminiResp = JSON.parse(body);
      const candidates = geminiResp.candidates || [];
      const first = candidates[0]?.content?.parts || [];
      const text = first.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join('\n');

      const openaiResp: OpenAIResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: geminiResp.modelVersion || '',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text,
            },
            finish_reason: mapGeminiFinishReason(candidates[0]?.finishReason),
          },
        ],
        usage: {
          prompt_tokens: geminiResp.usageMetadata?.promptTokenCount || 0,
          completion_tokens: geminiResp.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: geminiResp.usageMetadata?.totalTokenCount || 0,
        },
      };

      return { body: JSON.stringify(openaiResp), status: 200 };
    } catch {
      return { body, status };
    }
  },
};

function mapGeminiFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    default: return reason || 'stop';
  }
}
```

- [ ] **Step 5: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/transformer/types.ts src/transformer/openai.ts src/transformer/anthropic.ts src/transformer/gemini.ts
git commit -m "feat: add OpenAI, Anthropic, and Gemini format transformers"
```

---

### Task 13: Smart Router

**Files:**
- Create: `src/router/detector.ts`
- Create: `src/router/index.ts`

- [ ] **Step 1: Write src/router/detector.ts**

```typescript
import type { OpenAIMessage } from '../types';

export type ContentType = 'text' | 'image' | 'audio' | 'file';

export function detectContentTypes(messages: OpenAIMessage[]): Set<ContentType> {
  const types = new Set<ContentType>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      types.add('text');
      continue;
    }

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') types.add('text');
        if (part.type === 'image_url') types.add('image');
        if (part.type === 'input_audio') types.add('audio');
        // file type is detected via tool calls or file attachments
      }
    }
  }

  // Always have at least text
  if (types.size === 0) types.add('text');

  return types;
}
```

- [ ] **Step 2: Write src/router/index.ts**

```typescript
import type { Env } from '../index';
import type { Binding, Endpoint, EndpointModel, RouteResult } from '../types';
import { kvGet } from '../utils/kv';
import { detectContentTypes } from './detector';
import type { OpenAIRequest } from '../types';
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
  // 1. Detect content types
  const detectedTypes = detectContentTypes(request.messages);

  // 2. Get all bindings for this key
  const bindingIndex = await kvGet<{ model_name: string; endpoint_id: string }[]>(
    env,
    `binding_index/${keyId}`,
  );
  if (!bindingIndex || bindingIndex.length === 0) {
    return {
      type: 'no_binding',
      message: `No endpoints configured for key`,
    };
  }

  // 3. Load all bindings and filter by model_name + request_types match
  const candidates: { binding: Binding; endpoint: Endpoint; model: EndpointModel }[] = [];

  for (const entry of bindingIndex) {
    if (entry.model_name !== request.model) continue;

    const binding = await kvGet<Binding>(env, `bindings/${keyId}:${entry.model_name}`);
    if (!binding) continue;

    // Check if binding covers all detected content types
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

  // 4. Sort by priority (ascending)
  candidates.sort((a, b) => a.binding.priority - b.binding.priority);

  // 5. Estimate request tokens
  const requestTokens = estimateTokens(request);

  // 6. Filter by context window
  const fitting = candidates.filter((c) => c.model.context_window > requestTokens);

  if (fitting.length === 0) {
    return {
      type: 'context_too_long',
      message: `Request exceeds context window for all matching endpoints`,
      extra: {
        request_tokens: requestTokens,
        max_context: Math.max(...candidates.map((c) => c.model.context_window)),
      },
    };
  }

  // 7. Select first fitting candidate
  const selected = fitting[0];
  return {
    endpoint: selected.endpoint,
    model: selected.model,
  };
}
```

- [ ] **Step 3: Write src/utils/tokens.ts**

```typescript
import type { OpenAIRequest } from '../types';

const CHARS_PER_TOKEN = 4;
const SAFETY_MARGIN = 0.8;

export function estimateTokens(request: OpenAIRequest): number {
  const body = JSON.stringify(request);
  const estimated = Math.ceil(body.length / CHARS_PER_TOKEN);
  // Apply safety margin so we don't reject borderline requests
  return estimated;
}

export function fitsInContext(contextWindow: number, requestTokens: number): boolean {
  return requestTokens < contextWindow * SAFETY_MARGIN;
}
```

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/router/detector.ts src/router/index.ts src/utils/tokens.ts
git commit -m "feat: add smart router with content type detection and context window validation"
```

---

### Task 14: Proxy Service + Route

**Files:**
- Create: `src/services/proxy.ts`
- Create: `src/routes/proxy.ts`

- [ ] **Step 1: Write src/services/proxy.ts**

```typescript
import type { Env } from '../index';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest, Endpoint, EndpointModel, RouteResult } from '../types';
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
  // Route the request
  const route = routeRequest(env, keyId, request);

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

  // Transform request
  const transformed = transformer.transformRequest(request, model.real_model, endpoint.api_key);

  // Construct full URL
  const fullUrl = endpoint.base_url.replace(/\/$/, '') + transformed.url;

  // Proxy
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

  // Transform response back to OpenAI format
  const { body: openaiBody, status } = transformer.transformResponse(responseBody, response.status);

  // Extract tokens for stats
  let tokens = 0;
  try {
    const parsed = JSON.parse(openaiBody);
    tokens = parsed.usage?.total_tokens || 0;
  } catch {}

  // Record stats asynchronously (don't block response)
  void recordStats(env, userId, keyId, request.model, {
    tokens,
    responseTimeMs,
    statusCode: status,
  });

  return {
    result: {
      status,
      body: openaiBody,
      tokens,
      responseTimeMs,
    },
    modelName: request.model,
  };
}
```

- [ ] **Step 2: Write src/routes/proxy.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { proxyRequest } from '../services/proxy';
import { badRequestError } from '../utils/response';
import type { OpenAIRequest } from '../types';

const proxyRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

proxyRoutes.use('*', authMiddleware);

proxyRoutes.post('/chat/completions', async (c) => {
  const body = await c.req.json<OpenAIRequest>();
  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    return badRequestError(c, 'model and messages are required');
  }

  const auth = c.get('auth');
  const outcome = await proxyRequest(c.env, auth.key_id, auth.user_id, body);

  if ('error' in outcome) {
    return c.json(JSON.parse(outcome.error.body), outcome.error.status);
  }

  return c.json(JSON.parse(outcome.result.body), outcome.result.status);
});

export { proxyRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors (will warn about `void recordStats(...)` — intentional).

- [ ] **Step 4: Commit**

```bash
git add src/services/proxy.ts src/routes/proxy.ts
git commit -m "feat: add proxy service with routing, format transformation, and forwarding"
```

---

### Task 15: Stats Service + Routes

**Files:**
- Create: `src/services/stats.ts`
- Create: `src/routes/stats.ts`

- [ ] **Step 1: Write src/services/stats.ts**

```typescript
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
  return {
    requests: 0,
    tokens: 0,
    avg_response_time_ms: 0,
    status_codes: {},
  };
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

  // Update totals
  const oldTotalReqs = stats.total_requests;
  stats.total_requests += 1;
  stats.total_tokens += data.tokens;

  // Rolling average for response time
  stats.avg_response_time_ms =
    (stats.avg_response_time_ms * oldTotalReqs + data.responseTimeMs) / stats.total_requests;

  // Status codes
  const codeStr = String(data.statusCode);
  stats.status_codes[codeStr] = (stats.status_codes[codeStr] || 0) + 1;

  // By key
  if (!stats.by_key[keyId]) stats.by_key[keyId] = emptyByEntity();
  const bk = stats.by_key[keyId];
  bk.requests += 1;
  bk.tokens += data.tokens;
  bk.avg_response_time_ms = (bk.avg_response_time_ms * (bk.requests - 1) + data.responseTimeMs) / bk.requests;
  bk.status_codes[codeStr] = (bk.status_codes[codeStr] || 0) + 1;

  // By model
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
```

- [ ] **Step 2: Write src/routes/stats.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { getStats, getKeyStats, getModelStats } from '../services/stats';
import { jsonOk, notFoundError } from '../utils/response';

const statsRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

statsRoutes.use('*', authMiddleware);

statsRoutes.get('/', async (c) => {
  const date = c.req.query('date');
  const stats = await getStats(c.env, c.get('auth').user_id, date);
  return jsonOk(c, stats);
});

statsRoutes.get('/keys/:key_id', async (c) => {
  const date = c.req.query('date');
  const stats = await getKeyStats(c.env, c.get('auth').user_id, c.req.param('key_id'), date);
  if (!stats) return notFoundError(c, 'No stats found for this key');
  return jsonOk(c, stats);
});

statsRoutes.get('/models/:model_name', async (c) => {
  const date = c.req.query('date');
  const stats = await getModelStats(c.env, c.get('auth').user_id, c.req.param('model_name'), date);
  if (!stats) return notFoundError(c, 'No stats found for this model');
  return jsonOk(c, stats);
});

export { statsRoutes };
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/stats.ts src/routes/stats.ts
git commit -m "feat: add usage statistics recording and query endpoints"
```

---

### Task 16: Billing Handlers + Routes

**Files:**
- Create: `src/billing/types.ts`
- Create: `src/billing/registry.ts`
- Create: `src/billing/openai.ts`
- Create: `src/billing/anthropic.ts`
- Create: `src/billing/deepseek.ts`
- Create: `src/billing/moonshot.ts`
- Create: `src/billing/zhipu.ts`
- Create: `src/billing/aliyun.ts`
- Create: `src/routes/billing.ts`

- [ ] **Step 1: Write src/billing/types.ts**

```typescript
export interface BalanceResult {
  available: boolean;
  total?: number;
  used?: number;
  remaining?: number;
  currency?: string;
  raw?: unknown;
}

export interface BillingHandler {
  provider: string;
  queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult>;
}
```

- [ ] **Step 2: Write src/billing/registry.ts**

```typescript
import type { BillingHandler } from './types';

const handlers = new Map<string, BillingHandler>();

export function registerBillingHandler(handler: BillingHandler): void {
  handlers.set(handler.provider, handler);
}

export function getBillingHandler(provider: string): BillingHandler | undefined {
  return handlers.get(provider);
}

export function getRegisteredProviders(): string[] {
  return [...handlers.keys()];
}
```

- [ ] **Step 3: Write src/billing/openai.ts**

```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const openaiHandler: BillingHandler = {
  provider: 'openai',

  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');

      // Get subscription info
      const subResp = await fetch(`${base}/v1/dashboard/billing/subscription`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!subResp.ok) return { available: false };

      const sub = await subResp.json<{ hard_limit_usd: number; soft_limit_usd: number }>();

      // Get current usage
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const endDate = now.toISOString().slice(0, 10);

      const usageResp = await fetch(
        `${base}/v1/usage?date=${startDate}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (!usageResp.ok) return { available: false };

      const usage = await usageResp.json<{ total_usage: number }>();

      const total = sub.hard_limit_usd;
      const used = usage.total_usage / 100;
      const remaining = total - used;

      return {
        available: true,
        total: Math.round(total * 100) / 100,
        used: Math.round(used * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        currency: 'USD',
        raw: { subscription: sub, usage },
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(openaiHandler);
```

- [ ] **Step 4: Write src/billing/anthropic.ts, deepseek.ts, moonshot.ts, zhipu.ts, aliyun.ts**

Each follows the same pattern. Write them together:

**src/billing/anthropic.ts:**
```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const anthropicHandler: BillingHandler = {
  provider: 'anthropic',

  async queryBalance(_apiKey: string, _baseUrl?: string): Promise<BalanceResult> {
    // Anthropic doesn't have a public balance API
    // Usage is tracked via response headers (rate-limit info only)
    return { available: false };
  },
};

registerBillingHandler(anthropicHandler);
```

**src/billing/deepseek.ts:**
```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const deepseekHandler: BillingHandler = {
  provider: 'deepseek',

  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
      const resp = await fetch(`${base}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };

      const data = await resp.json<{
        balance_infos: Array<{ total_balance: string; currency: string }>;
      }>();

      const total = parseFloat(data.balance_infos?.[0]?.total_balance || '0');
      const currency = data.balance_infos?.[0]?.currency || 'CNY';

      return {
        available: true,
        total,
        remaining: total,
        currency,
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(deepseekHandler);
```

**src/billing/moonshot.ts:**
```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const moonshotHandler: BillingHandler = {
  provider: 'moonshot',

  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.moonshot.cn').replace(/\/$/, '');
      const resp = await fetch(`${base}/v1/users/me/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };

      const data = await resp.json<{ data: { balance: number; currency: string } }>();

      return {
        available: true,
        total: data.data.balance,
        remaining: data.data.balance,
        currency: data.data.currency || 'CNY',
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(moonshotHandler);
```

**src/billing/zhipu.ts:**
```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const zhipuHandler: BillingHandler = {
  provider: 'zhipu',

  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://open.bigmodel.cn').replace(/\/$/, '');
      const resp = await fetch(`${base}/api/paas/v4/report`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };

      const data = await resp.json<{ data: { balance: number } }>();

      return {
        available: true,
        total: data.data.balance,
        remaining: data.data.balance,
        currency: 'CNY',
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(zhipuHandler);
```

**src/billing/aliyun.ts:**
```typescript
import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const aliyunHandler: BillingHandler = {
  provider: 'aliyun',

  async queryBalance(apiKey: string, _baseUrl?: string): Promise<BalanceResult> {
    try {
      // DashScope billing API
      const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/billing/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };

      const data = await resp.json<{ output: { balance: number } }>();

      return {
        available: true,
        total: data.output.balance,
        remaining: data.output.balance,
        currency: 'CNY',
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(aliyunHandler);
```

- [ ] **Step 5: Write src/routes/billing.ts**

```typescript
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthContext } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { getEndpoint } from '../services/endpoint';
import { getBillingHandler } from '../billing/registry';
import { jsonOk, jsonError, notFoundError } from '../utils/response';

// Import all billing handlers to register them
import '../billing/openai';
import '../billing/anthropic';
import '../billing/deepseek';
import '../billing/moonshot';
import '../billing/zhipu';
import '../billing/aliyun';

const billingRoutes = new Hono<{ Bindings: Env; Variables: { auth: AuthContext } }>();

billingRoutes.use('*', authMiddleware);

billingRoutes.get('/endpoints/:endpoint_id/balance', async (c) => {
  const auth = c.get('auth');
  const ep = await getEndpoint(c.env, auth.user_id, c.req.param('endpoint_id'));
  if (!ep) return notFoundError(c, 'Endpoint not found');

  const handler = getBillingHandler(ep.format);
  if (!handler) {
    return jsonOk(c, {
      endpoint_id: ep.endpoint_id,
      endpoint_name: ep.name,
      provider: ep.format,
      balance: { available: false },
    });
  }

  const balance = await handler.queryBalance(ep.api_key, ep.base_url);

  return jsonOk(c, {
    endpoint_id: ep.endpoint_id,
    endpoint_name: ep.name,
    provider: handler.provider,
    balance,
  });
});

billingRoutes.get('/endpoints/balances', async (c) => {
  const auth = c.get('auth');
  const { listEndpoints } = await import('../services/endpoint');
  const endpoints = await listEndpoints(c.env, auth.user_id);

  const results = [];
  for (const ep of endpoints) {
    const handler = getBillingHandler(ep.format);
    const balance = handler
      ? await handler.queryBalance(ep.api_key, ep.base_url)
      : { available: false };

    results.push({
      endpoint_id: ep.endpoint_id,
      endpoint_name: ep.name,
      provider: handler?.provider || ep.format,
      balance,
    });
  }

  return jsonOk(c, { balances: results });
});

export { billingRoutes };
```

- [ ] **Step 6: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/billing/ src/routes/billing.ts
git commit -m "feat: add pluggable billing handlers for 6 major LLM providers"
```

---

### Task 17: Wire Everything Together in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Rewrite src/index.ts**

```typescript
import { Hono } from 'hono';
import { authRoutes } from './routes/auth';
import { keyRoutes } from './routes/keys';
import { endpointRoutes } from './routes/endpoints';
import { bindingRoutes } from './routes/bindings';
import { modelRoutes } from './routes/models';
import { proxyRoutes } from './routes/proxy';
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
app.route('/v1', proxyRoutes);
app.route('/v1/stats', statsRoutes);

// 404 catch-all
app.all('*', (c) => c.json({ error: { message: 'Not found', type: 'not_found' } }, 404));

export default app;
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify Wrangler can build**

```bash
npx wrangler deploy --dry-run 2>&1 || true
```

Just confirm it doesn't error on syntax/module resolution.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire all routes into the Hono app"
```

---

### Task 18: Final Review — Type Consistency & Cross-Reference Check

**Files:**
- Review: all src/ files

- [ ] **Step 1: Run full typecheck**

```bash
npx tsc --noEmit
```

Fix any type errors. Verify no errors remain.

- [ ] **Step 2: Verify KV key patterns are consistent**

Check that all KV key references use the patterns from section 12 of the design:
- `users/{user_id}` ✓
- `keys/{key_id}` ✓
- `endpoints/{endpoint_id}` ✓
- `bindings/{key_id}:{model_name}` ✓
- `email_index/{email_hash}` ✓
- `key_index/{user_id}` ✓
- `endpoint_index/{user_id}` ✓
- `binding_index/{key_id}` ✓
- `key_prefix_index/{prefix}` ✓
- `stats/{user_id}:{date}` ✓

- [ ] **Step 3: Verify all API routes match the design spec**

| Spec Route | Implementation |
|---|---|
| POST /v1/auth/register | `authRoutes.post('/register', ...)` via `/v1/auth` |
| POST /v1/auth/login | `authRoutes.post('/login', ...)` via `/v1/auth` |
| GET /v1/models | `modelRoutes.get('/', ...)` via `/v1/models` |
| POST /v1/keys | `keyRoutes.post('/', ...)` via `/v1/keys` |
| GET /v1/keys | `keyRoutes.get('/', ...)` via `/v1/keys` |
| GET /v1/keys/:key_id | `keyRoutes.get('/:key_id', ...)` via `/v1/keys` |
| PATCH /v1/keys/:key_id | `keyRoutes.patch('/:key_id', ...)` via `/v1/keys` |
| DELETE /v1/keys/:key_id | `keyRoutes.delete('/:key_id', ...)` via `/v1/keys` |
| POST /v1/endpoints | `endpointRoutes.post('/', ...)` via `/v1/endpoints` |
| GET /v1/endpoints | `endpointRoutes.get('/', ...)` via `/v1/endpoints` |
| GET /v1/endpoints/:id | `endpointRoutes.get('/:endpoint_id', ...)` via `/v1/endpoints` |
| PUT /v1/endpoints/:id | `endpointRoutes.put('/:endpoint_id', ...)` via `/v1/endpoints` |
| DELETE /v1/endpoints/:id | `endpointRoutes.delete('/:endpoint_id', ...)` via `/v1/endpoints` |
| PUT /v1/keys/:key_id/bindings | `bindingRoutes.put('/:key_id/bindings', ...)` via `/v1/keys` |
| GET /v1/keys/:key_id/bindings | `bindingRoutes.get('/:key_id/bindings', ...)` via `/v1/keys` |
| POST /v1/chat/completions | `proxyRoutes.post('/chat/completions', ...)` via `/v1` |
| GET /v1/stats | `statsRoutes.get('/', ...)` via `/v1/stats` |
| GET /v1/stats/keys/:key_id | `statsRoutes.get('/keys/:key_id', ...)` via `/v1/stats` |
| GET /v1/stats/models/:name | `statsRoutes.get('/models/:model_name', ...)` via `/v1/stats` |
| GET /v1/endpoints/:id/balance | `billingRoutes.get('/endpoints/:endpoint_id/balance', ...)` via `/v1/endpoints` |
| GET /v1/endpoints/balances | `billingRoutes.get('/endpoints/balances', ...)` via `/v1/endpoints` |

- [ ] **Step 4: Verify all type imports/exports are correct**

Check that every imported type exists in `src/types.ts`. Check that every imported function exists in its source file.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: final cross-reference and type consistency fixes"
```
