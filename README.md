# LLM Gateway

A multi-tenant LLM API gateway built on Cloudflare Workers. Accept requests in **OpenAI**, **Anthropic**, or **Gemini** format — route to any upstream provider with automatic format transformation. Full streaming (SSE) support for all 9 format combinations.

## Features

- **Multi-format proxy** — Clients use their preferred format; the gateway transforms between OpenAI, Anthropic, and Gemini
- **Bidirectional transformation** — All 9 combinations (3 client × 3 upstream) with streaming
- **Smart routing** — Content type detection, request type specificity, context window validation with 80% safety margin
- **SSE streaming** — Full streaming support with real-time format conversion
- **Multi-tenant** — User registration, API key management, per-key endpoint bindings
- **Usage statistics** — Per-user, per-key, per-model stats with response time tracking
- **Billing queries** — Pluggable handlers for OpenAI, Anthropic, DeepSeek, Moonshot, Zhipu, Aliyun
- **Edge-native** — Runs on Cloudflare Workers with KV storage, zero cold-start servers

## Architecture

```
Client (OpenAI/Anthropic/Gemini)
  │
  ▼
┌─────────────────────────┐
│  Route Handler          │  Path-based format detection
│  /v1/openai/...         │
│  /v1/anthropic/...      │
│  /v1/gemini/...         │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Transformer            │  decodeRequest → OpenAI intermediate
│  (per format)           │  encodeRequest → upstream format
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Smart Router           │  Content type detection
│                         │  Request type specificity
│                         │  Context window validation (80%)
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Proxy Service          │  Forward to upstream
│                         │  Transform response
│                         │  Passthrough optimization
└─────────────────────────┘
```

OpenAI format serves as the intermediate representation for cross-format transformation. When client format matches upstream format, the passthrough optimization skips transformation entirely.

## Quick Start

### Prerequisites

- Node.js 18+
- A Cloudflare account with Workers enabled

### Setup

```bash
# Clone the repository
git clone https://github.com/adam-ikari/llm_gateway.git
cd llm_gateway

# Install dependencies
npm install

# Create KV namespace
wrangler kv:namespace create "KV"

# Update wrangler.toml with the KV namespace IDs from the output above
```

### Development

```bash
# Run locally
npm run dev

# Type check
npm run typecheck

# Run tests
npm run test

# Lint
npm run lint

# Format
npm run format
```

### Deploy

```bash
npm run deploy
```

## API Reference

All authenticated endpoints require an `Authorization: Bearer <api-key>` header.

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/auth/register` | Register a new user |
| POST | `/v1/auth/login` | Login and get API key |

**Register:**
```bash
curl -X POST http://localhost:8787/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'
```

**Login:**
```bash
curl -X POST http://localhost:8787/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'
```

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/keys` | Create a new API key |
| GET | `/v1/keys` | List all API keys |
| GET | `/v1/keys/:key_id` | Get a specific key |
| PATCH | `/v1/keys/:key_id` | Update a key (name, is_active) |
| DELETE | `/v1/keys/:key_id` | Delete a key |

**Create key:**
```bash
curl -X POST http://localhost:8787/v1/keys \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"name": "My Key"}'
```

### Endpoints (Upstream Providers)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/endpoints` | Add an upstream endpoint |
| GET | `/v1/endpoints` | List all endpoints |
| GET | `/v1/endpoints/:id` | Get an endpoint |
| PUT | `/v1/endpoints/:id` | Update an endpoint |
| DELETE | `/v1/endpoints/:id` | Delete an endpoint |

**Create endpoint:**
```bash
curl -X POST http://localhost:8787/v1/endpoints \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenAI",
    "base_url": "https://api.openai.com",
    "api_key": "sk-openai-...",
    "format": "openai",
    "supported_models": [
      {
        "name": "gpt-4o",
        "real_model": "gpt-4o",
        "context_window": 128000,
        "max_output_tokens": 16384
      }
    ]
  }'
```

`format` must be one of: `openai`, `anthropic`, `gemini`.

### Bindings

Bindings connect an API key to an upstream endpoint for a specific model.

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/v1/keys/:key_id/bindings` | Set bindings for a key |
| GET | `/v1/keys/:key_id/bindings` | Get bindings for a key |

**Set bindings:**
```bash
curl -X PUT http://localhost:8787/v1/keys/:key_id/bindings \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "bindings": [
      {
        "model_name": "gpt-4o",
        "endpoint_id": "ep_xxx",
        "priority": 1,
        "request_types": ["text", "image"]
      }
    ]
  }'
```

- `priority`: Lower number = higher priority
- `request_types`: Content types this binding supports (`text`, `image`, `audio`, `file`). More specific bindings (more types) are preferred.

### Proxy (LLM Chat)

#### OpenAI Format

```bash
# Backward compatible
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Explicit OpenAI format
curl -X POST http://localhost:8787/v1/openai/chat/completions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Anthropic Format

```bash
curl -X POST http://localhost:8787/v1/anthropic/messages \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "system": "You are helpful.",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

#### Gemini Format

```bash
# Non-streaming
curl -X POST http://localhost:8787/v1/gemini/models/gemini-2.5-flash:generateContent \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello!"}]}]
  }'

# Streaming
curl -X POST http://localhost:8787/v1/gemini/models/gemini-2.5-flash:streamGenerateContent \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello!"}]}]
  }'
```

### Model Presets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/models` | List available model presets |

### Usage Statistics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/stats` | Get overall stats |
| GET | `/v1/stats/keys/:key_id` | Get stats for a key |
| GET | `/v1/stats/models/:model_name` | Get stats for a model |

Query parameter: `date` (YYYY-MM-DD format, defaults to today).

### Billing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/endpoints/:endpoint_id/balance` | Query balance for an endpoint |
| GET | `/v1/endpoints/balances` | Query balance for all endpoints |

Supported providers: OpenAI, Anthropic, DeepSeek, Moonshot, Zhipu, Aliyun.

## Smart Routing

When a request arrives, the router:

1. **Detects content types** — Analyzes messages for text, image, audio, file content
2. **Finds matching bindings** — Filters by model name and content type coverage
3. **Sorts by specificity** — Bindings with more `request_types` are preferred (e.g., `["text", "image"]` beats `["text"]`)
4. **Sorts by priority** — Among equal specificity, lower priority number wins
5. **Validates context window** — Uses 80% safety margin (`requestTokens < contextWindow * 0.8`)
6. **Selects first fitting candidate** — Returns 400 if request exceeds all context windows

## Format Transformation

### Request Flow

```
Client Format → decodeRequest() → OpenAI Intermediate → encodeRequest() → Upstream Format
```

### Response Flow (Non-streaming)

```
Upstream Response → decodeResponse() → OpenAI Intermediate → encodeResponse() → Client Format
```

### Response Flow (Streaming)

```
Upstream SSE → parseSSEStream() → decodeStream() → encodeStream() → serializeSSEStream() → Client SSE
```

### Supported Conversions

| Client \ Upstream | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| **OpenAI** | ✅ passthrough | ✅ | ✅ |
| **Anthropic** | ✅ | ✅ passthrough | ✅ |
| **Gemini** | ✅ | ✅ | ✅ passthrough |

Passthrough means zero transformation overhead when client format matches upstream format.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Storage:** Cloudflare KV
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest
- **Linting:** ESLint + typescript-eslint
- **Formatting:** Prettier

## Project Structure

```
src/
├── billing/           # Pluggable billing handlers per provider
├── data/              # Model presets
├── middleware/         # Auth middleware
├── router/            # Smart routing with content detection
├── routes/            # Hono route handlers
├── services/          # Business logic
├── transformer/       # Bidirectional format transformers
│   ├── anthropic.ts   # Anthropic ↔ OpenAI
│   ├── gemini.ts      # Gemini ↔ OpenAI
│   ├── openai.ts      # OpenAI (passthrough/identity)
│   └── types.ts       # Transformer interface
├── utils/             # Crypto, KV helpers, SSE, tokens, response
├── index.ts           # App entry point & route wiring
└── types.ts           # Shared type definitions
```

## License

MIT
