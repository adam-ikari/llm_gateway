# Cloudflare Workers LLM Gateway — Design Specification

**Date:** 2026-06-18
**Status:** Final

---

## 1. Overview

A multi-tenant LLM API gateway built on Cloudflare Workers + KV, supporting:

- User self-registration and API key management
- Multi-model endpoint routing with format conversion
- Intelligent routing based on request content type (text/image/audio/video/file)
- Per-key binding of virtual model names to provider endpoints
- Context window validation during routing (prevents failures when switching model types)
- Usage statistics (requests, tokens, response time, status codes)
- Balance/credit queries for major LLM providers with pluggable handlers

Clients communicate with the gateway using a unified OpenAI-compatible format. The gateway transforms requests/responses to the target provider's native format transparently.

## 2. Architecture

```
                         ┌──────────────────────────────────────────┐
                         │            Cloudflare Worker              │
                         │                                          │
Client ─► /v1/*         │  ┌────────┐  ┌────────┐  ┌───────────┐  │
         Bearer <key>   │  │  Auth  │─►│ Router │─►│Transformer │  │
                         │  │   MW   │  │        │  │           │  │
                         │  └────────┘  └────────┘  └───────────┘  │
                         │                   │             │         │
                         │                   ▼             ▼         │
                         │           ┌───────────┐ ┌───────────┐    │
                         │           │  KV Store │ │   Proxy   │    │
                         │           │           │ │  + Stats  │    │
                         │           └───────────┘ └───────────┘    │
                         │                                │          │
                         │                                ▼          │
                         └─────────────────────── Target API ───────┘
```

## 3. Data Models

### 3.1 Users

```
users/{user_id} → {
  user_id: string,
  email: string,
  password_hash: string,
  created_at: number,            // Unix timestamp
}
```

### 3.2 Keys

```
keys/{key_id} → {
  key_id: string,
  user_id: string,
  key_hash: string,               // SHA-256 hash of the full API key
  key_prefix: string,             // First 8 chars for display "sk-abc123..."
  name: string,
  is_active: boolean,
  created_at: number,
}
```

### 3.3 Endpoints

```
endpoints/{endpoint_id} → {
  endpoint_id: string,
  user_id: string,
  name: string,                   // Display name
  base_url: string,               // API base URL
  api_key: string,                // Target API key (encrypted at rest)
  format: "openai" | "anthropic" | "gemini",
  supported_models: [
    {
      name: string,               // Virtual model name (matches gateway model)
      real_model: string,         // Real model name on target API
      context_window: number,     // Context window in tokens
      max_output_tokens: number,  // Max output tokens
    }
  ],
  created_at: number,
  updated_at: number,
}
```

### 3.4 Bindings

```
bindings/{key_id}:{model_name} → {
  key_id: string,
  model_name: string,             // Virtual model name
  endpoint_id: string,            // Endpoint handling this model
  priority: number,               // Lower = higher priority
  request_types: string[],        // ["text"] | ["text","image"] | ["text","image","audio"] etc.
}
```

A key can bind the same model_name to multiple endpoints differentiated by request_types. This enables routing text requests to one endpoint and multimodal requests to another.

### 3.5 Models (Presets)

```
models/{model_name} → {
  name: string,                   // Virtual model name
  display_name: string,
  description: string,
  capabilities: {
    text: boolean,
    image: boolean,
    audio: boolean,
    video: boolean,
    file: boolean,
  },
  context_window: number,         // Default context window (informational)
  max_output_tokens: number,      // Default max output (informational)
  default_format: "openai" | "anthropic" | "gemini",
}
```

### 3.6 Statistics

```
stats/{user_id}:{date} → {
  total_requests: number,
  total_tokens: number,
  avg_response_time_ms: number,
  status_codes: {
    "200": number,
    "400": number,
    "401": number,
    "403": number,
    "429": number,
    "500": number,
    "502": number,
    "503": number,
    ...
  },
  by_key: {
    key_id: {
      requests: number,
      tokens: number,
      avg_response_time_ms: number,
      status_codes: { ... },
    }
  },
  by_model: {
    model_name: {
      requests: number,
      tokens: number,
      avg_response_time_ms: number,
      status_codes: { ... },
    }
  },
}
```

Statistics are aggregated per user per day. Each proxy request updates the stats atomically using KV (optimistic concurrency via read-modify-write).

## 4. API Reference

### 4.1 Authentication (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/auth/register` | Register a new user, returns user_id + initial API key |
| POST | `/v1/auth/login` | Login with email/password, returns user_id + API key |

**POST /v1/auth/register**
```
Request:  { "email": "user@example.com", "password": "password123" }
Response: { "user_id": "...", "api_key": "sk-abc123...", "email": "user@example.com" }
```

**POST /v1/auth/login**
```
Request:  { "email": "user@example.com", "password": "password123" }
Response: { "user_id": "...", "api_key": "sk-abc123...", "email": "user@example.com" }
```

### 4.2 Models List (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/models` | List all available virtual models with capabilities |

### 4.3 Key Management (Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/keys` | Create a new API key |
| GET | `/v1/keys` | List all keys for current user |
| GET | `/v1/keys/{key_id}` | Get key details |
| PATCH | `/v1/keys/{key_id}` | Update key (name, is_active) |
| DELETE | `/v1/keys/{key_id}` | Delete a key |

Key format: `sk-` + 32 hex characters (e.g. `sk-a1b2c3d4e5f6g7h8`)

### 4.4 Endpoint Management (Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/endpoints` | Create a provider endpoint |
| GET | `/v1/endpoints` | List all endpoints for current user |
| GET | `/v1/endpoints/{endpoint_id}` | Get endpoint details |
| PUT | `/v1/endpoints/{endpoint_id}` | Update endpoint |
| DELETE | `/v1/endpoints/{endpoint_id}` | Delete endpoint |

**POST /v1/endpoints**
```
Request: {
  "name": "My OpenAI",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-openai-xxx",
  "format": "openai",
  "supported_models": [
    {
      "name": "gpt-4o",
      "real_model": "gpt-4o-2024-08-06",
      "context_window": 128000,
      "max_output_tokens": 16384
    },
    {
      "name": "gpt-4o-mini",
      "real_model": "gpt-4o-mini",
      "context_window": 128000,
      "max_output_tokens": 16384
    }
  ]
}
```

### 4.5 Binding Management (Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/v1/keys/{key_id}/bindings` | Set all bindings for a key (full replace) |
| GET | `/v1/keys/{key_id}/bindings` | Get all bindings for a key |

**PUT /v1/keys/{key_id}/bindings**
```
Request: {
  "bindings": [
    {
      "model_name": "gpt-4o",
      "endpoint_id": "ep_xxx",
      "request_types": ["text"],
      "priority": 0
    },
    {
      "model_name": "gpt-4o",
      "endpoint_id": "ep_yyy",
      "request_types": ["text", "image"],
      "priority": 1
    }
  ]
}
```

### 4.6 Proxy (core — Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/chat/completions` | Chat completion proxy with smart routing |

**POST /v1/chat/completions**
```
Header: Authorization: Bearer sk-abc123...
Request: {
  "model": "gpt-4o",                          // Virtual model name
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "max_tokens": 1024,
  "stream": false
}
```

The gateway:
1. Authenticates the API key
2. Detects request content type from `messages`
3. Looks up key bindings for the virtual model_name
4. Filters bindings by request_types match
5. Sorts by priority (ascending)
6. Estimates request token count
7. Filters out endpoints where context_window < request tokens
8. Selects first matching endpoint
9. Transforms request to target endpoint format
10. Proxies to target API
11. Transforms response back to OpenAI format
12. Records statistics (tokens, response time, status code)

### 4.7 Statistics (Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/stats` | Overview stats for current user |
| GET | `/v1/stats/keys/{key_id}` | Stats for a specific key |
| GET | `/v1/stats/models/{model_name}` | Stats for a specific model |

### 4.8 Balance / Credit Queries (Bearer auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/endpoints/{endpoint_id}/balance` | Query balance for one endpoint |
| GET | `/v1/endpoints/balances` | Query balance for all endpoints |

**GET /v1/endpoints/{endpoint_id}/balance**
```
Response: {
  "endpoint_id": "ep_xxx",
  "endpoint_name": "My OpenAI",
  "provider": "openai",
  "balance": {
    "available": true,
    "total": 100.00,
    "used": 23.45,
    "remaining": 76.55,
    "currency": "USD"
  }
}
```

## 5. Smart Routing

### 5.1 Content Type Detection

The router inspects the incoming `messages` array to determine content types:

| Content in message | Detected type |
|--------------------|---------------|
| Plain text content | `text` |
| `image_url` in content array | `image` |
| `input_audio` or audio content | `audio` |
| `file` reference | `file` |

### 5.2 Routing Algorithm

```
1. Authenticate API key → get key_id, user_id
2. Detect request_types from request body
3. Look up all bindings for (key_id, model_name)
4. Filter bindings where binding.request_types ⊇ detected request_types
5. Sort by priority (ascending)
6. Estimate request token count (character count / 4, with safety margin)
7. Look up endpoint + model config for each candidate binding
8. Filter out bindings where endpoint model's context_window < estimated request tokens
9. Select first remaining match → use its endpoint_id + real_model
10. If no match after context filter: return 400 with error "context_too_long"
11. If no match at all: return 404 "No endpoint configured for this model/content-type"
```

### 5.3 Context Window Validation

When routing switches between endpoints (e.g., text endpoint → multimodal endpoint), the target endpoint's model may have a different context window. The gateway validates that the request fits within the target model's context window before forwarding.

| Scenario | Behavior |
|----------|----------|
| Request tokens < context_window | Normal forwarding |
| Request tokens >= context_window (all candidates) | 400 `{ "error": { "message": "Request exceeds context window for all matching endpoints", "type": "context_too_long", "request_tokens": N, "max_context": M } }` |
| Some candidates fit, some don't | Filter to fitting candidates, select by priority |

### 5.4 Token Estimation

Token count is estimated as `character_count / 4` with a configurable safety margin (default 80% of context window). This avoids an extra API call while providing a reasonable guard against context overflow.

### 5.5 Binding Precedence

Multiple bindings for the same model_name can coexist. Selection order:

1. `request_types` specificity (more types = more specific, preferred)
2. `priority` (lower number = higher priority)
3. Context window fit (must pass validation)

## 6. Format Transformation

### 6.1 Supported Formats

| Format | Request | Response |
|--------|---------|----------|
| `openai` | Passthrough | Passthrough |
| `anthropic` | OpenAI → Anthropic Messages API | Anthropic → OpenAI chat.completion |
| `gemini` | OpenAI → Gemini generateContent | Gemini → OpenAI chat.completion |

### 6.2 Transformer Interface

Each format transformer implements:

```typescript
interface Transformer {
  format: string;
  transformRequest(req: OpenAIRequest, realModel: string): Promise<TransformedRequest>;
  transformResponse(resp: Response, originalReq: OpenAIRequest): Promise<OpenAIResponse>;
}
```

New formats are added by creating a new transformer file and importing it. No custom/user-defined formats are supported — only built-in format handlers.

## 7. Billing / Balance Queries

### 7.1 Billing Handler Interface

```typescript
interface BillingHandler {
  provider: string;                    // e.g. "openai", "anthropic", "deepseek"
  queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult>;
}

interface BalanceResult {
  available: boolean;
  total?: number;
  used?: number;
  remaining?: number;
  currency?: string;
  raw?: unknown;
}
```

### 7.2 Registration (Pluggable)

```typescript
// registry.ts
const handlers = new Map<string, BillingHandler>();

export function registerBillingHandler(handler: BillingHandler) {
  handlers.set(handler.provider, handler);
}

export function getBillingHandler(provider: string): BillingHandler | undefined {
  return handlers.get(provider);
}
```

### 7.3 Supported Providers (Initial)

| Provider | Query API | Balance extraction |
|----------|-----------|-------------------|
| OpenAI | `/v1/dashboard/billing/subscription` + `/v1/usage?date=...` | `hard_limit_usd` - `total_usage` |
| Anthropic | Rate limit headers from response | Estimated from usage headers |
| DeepSeek | `/user/balance` | `balance_infos[0].total_balance` |
| Moonshot | `/v1/users/me/balance` | `data.balance` |
| Zhipu (智谱) | `/api/paas/v4/report` | balance field |
| Aliyun (通义) | DashScope console billing API | balance field |

To add a new provider: create a new billing handler file implementing `BillingHandler`, call `registerBillingHandler()`, and import it.

## 8. Directory Structure

```
llm_gateway/
├── src/
│   ├── index.ts                  # Worker entry point, route registration
│   ├── middleware/
│   │   └── auth.ts               # Bearer Token authentication middleware
│   ├── routes/
│   │   ├── auth.ts               # Register / Login
│   │   ├── keys.ts               # Key CRUD
│   │   ├── endpoints.ts          # Endpoint CRUD
│   │   ├── bindings.ts           # Key-endpoint binding management
│   │   ├── models.ts             # Model list
│   │   ├── proxy.ts              # Proxy + smart routing
│   │   ├── stats.ts              # Statistics queries
│   │   └── billing.ts            # Balance / credit queries
│   ├── services/
│   │   ├── auth.ts               # Auth business logic
│   │   ├── key.ts                # Key business logic
│   │   ├── endpoint.ts           # Endpoint business logic
│   │   ├── binding.ts            # Binding business logic
│   │   ├── proxy.ts              # Proxy business logic
│   │   ├── stats.ts              # Stats recording / query logic
│   │   └── billing.ts            # Billing orchestration
│   ├── transformer/
│   │   ├── index.ts              # Transformer dispatcher
│   │   ├── types.ts              # Transformer interface + request/response types
│   │   ├── openai.ts             # OpenAI transformer (passthrough)
│   │   ├── anthropic.ts          # Anthropic transformer
│   │   └── gemini.ts             # Gemini transformer
│   ├── billing/
│   │   ├── index.ts              # Billing dispatcher
│   │   ├── types.ts              # BillingHandler interface
│   │   ├── registry.ts           # Handler registry
│   │   ├── openai.ts             # OpenAI balance
│   │   ├── anthropic.ts          # Anthropic balance
│   │   ├── deepseek.ts           # DeepSeek balance
│   │   ├── moonshot.ts           # Moonshot balance
│   │   ├── zhipu.ts              # Zhipu balance
│   │   └── aliyun.ts             # Aliyun DashScope balance
│   ├── router/
│   │   ├── index.ts              # Smart routing engine
│   │   └── detector.ts           # Content type detection
│   ├── models/
│   │   └── types.ts              # TypeScript type definitions
│   ├── utils/
│   │   ├── crypto.ts             # Hashing, key generation
│   │   ├── kv.ts                 # KV operation helpers
│   │   ├── tokens.ts             # Token estimation
│   │   └── response.ts           # HTTP response formatters
│   └── data/
│       └── presets.ts            # Preset virtual models
├── wrangler.toml
├── package.json
└── tsconfig.json
```

## 9. Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Cloudflare Workers | Specified by user |
| Storage | Cloudflare KV | Specified by user |
| Language | TypeScript | Type safety, Workers support |
| Framework | Hono | Lightweight, native CF Worker routing |
| Hashing | Web Crypto API (`crypto.subtle`) | Native in Workers |
| Key Generation | `crypto.randomUUID()` | Secure random |
| No external packages beyond Hono | Minimal dependency footprint |

## 10. Error Handling

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| Missing/Invalid API key | 401 | `{ "error": { "message": "Invalid API key", "type": "auth_error" } }` |
| Model not found | 404 | `{ "error": { "message": "Model not found: xxx", "type": "not_found" } }` |
| No binding for model | 404 | `{ "error": { "message": "No endpoint configured for model xxx", "type": "no_binding" } }` |
| No binding for content type | 404 | `{ "error": { "message": "No endpoint configured for model xxx with content type yyy", "type": "no_binding" } }` |
| Context window exceeded (all candidates) | 400 | `{ "error": { "message": "Request exceeds context window for all matching endpoints", "type": "context_too_long", "request_tokens": N, "max_context": M } }` |
| Target API error | upstream status | Passthrough with target error body |
| Target API timeout | 502 | `{ "error": { "message": "Upstream timeout", "type": "gateway_error" } }` |
| Invalid request body | 400 | `{ "error": { "message": "...", "type": "invalid_request" } }` |

## 11. API Key Format & Security

- Format: `sk-` + 32 hex characters
- Storage: SHA-256 hash in KV
- Only the full API key is returned at creation time — never stored in plaintext
- `key_prefix` (first 8 chars after `sk-`) stored for user identification
- Password hashing via Web Crypto API PBKDF2

## 12. KV Key Design

| Pattern | Content | Notes |
|---------|---------|-------|
| `users/{user_id}` | User object | |
| `keys/{key_id}` | Key object | |
| `endpoints/{endpoint_id}` | Endpoint object | |
| `bindings/{key_id}:{model_name}` | Binding object | One per (key, model) pair |
| `models/{model_name}` | Model preset | System-managed |
| `stats/{user_id}:{date}` | Stats aggregate | Date = YYYY-MM-DD |
| `email_index/{email_hash}` | user_id | For login lookup (hash email with SHA-256) |

KV limitation: no list/query operations natively. The `email_index` pattern provides O(1) lookup for auth. Key listing is achieved by maintaining separate index keys:
- `key_index/{user_id}` → `["key_id_1", "key_id_2", ...]`
- `endpoint_index/{user_id}` → `["ep_id_1", "ep_id_2", ...]`
- `binding_index/{key_id}` → `[{model_name, endpoint_id}]`

## 13. Gateway Does NOT Handle

The gateway explicitly does NOT handle the following (by design):

| Concern | Rationale |
|---------|-----------|
| Rate limiting | Not in v1 scope |
| Retry / exponential backoff | Client or target API responsibility |
| Custom format templates | Only built-in formats (openai, anthropic, gemini) |
| Request/response caching | Not in v1 scope |
