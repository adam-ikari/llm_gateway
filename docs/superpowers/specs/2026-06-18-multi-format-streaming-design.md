# Multi-Format Gateway with Streaming — Design Specification

**Date:** 2026-06-18
**Status:** Final

---

## 1. Overview

Extend the LLM gateway to accept requests in **OpenAI, Anthropic, or Gemini format** via path-based routing, transform between any pair of formats, and support **streaming (SSE) for all 9 format combinations**.

Clients choose their preferred format by selecting the appropriate endpoint path. The response format always matches the request format. The gateway transparently transforms both request and response (including streaming events) between the client's format and the upstream provider's native format.

## 2. API Endpoints

### 2.1 Existing (backward-compatible)

| Method | Path | Request Format | Response Format |
|--------|------|---------------|-----------------|
| POST | `/v1/chat/completions` | OpenAI | OpenAI |

This route remains unchanged. Existing clients continue to work.

### 2.2 New Multi-Format Routes

| Method | Path | Request Format | Response Format |
|--------|------|---------------|-----------------|
| POST | `/v1/openai/chat/completions` | OpenAI | OpenAI |
| POST | `/v1/anthropic/messages` | Anthropic | Anthropic |
| POST | `/v1/gemini/models/{model}:generateContent` | Gemini | Gemini |

The `/v1/openai/chat/completions` route is functionally identical to `/v1/chat/completions` — both accept and return OpenAI format.

### 2.3 Route Resolution

All proxy routes share the same authentication and routing logic:
1. Authenticate via Bearer token (same as current)
2. Detect content types from the request body
3. Look up bindings for the requested model
4. Route to the best matching endpoint
5. Transform request from **client format → upstream format**
6. Forward to upstream
7. Transform response from **upstream format → client format**
8. Return to client

The client format is determined by the route path. The upstream format is determined by the endpoint's `format` field.

## 3. Transformation Architecture

### 3.1 Transformation Matrix

9 combinations (3 client formats × 3 upstream formats):

| Client ↓ / Upstream → | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| **OpenAI** | passthrough | OpenAI→Anthropic req / Anthropic→OpenAI resp | OpenAI→Gemini req / Gemini→OpenAI resp |
| **Anthropic** | Anthropic→OpenAI req / OpenAI→Anthropic resp | passthrough | Anthropic→Gemini req / Gemini→Anthropic resp |
| **Gemini** | Gemini→OpenAI req / OpenAI→Gemini resp | Gemini→Anthropic req / Anthropic→Gemini resp | passthrough |

### 3.2 Transformer Interface (Revised)

The current `Transformer` interface handles only OpenAI→X transformation. We need a bidirectional interface:

```typescript
interface Transformer {
  format: string;

  // Transform a request FROM this format TO OpenAI intermediate format
  // (used when this format is the CLIENT format)
  decodeRequest(body: unknown): OpenAIRequest;

  // Transform a request FROM OpenAI intermediate format TO this format
  // (used when this format is the UPSTREAM format)
  encodeRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest;

  // Transform a non-streaming response FROM this format TO OpenAI format
  // (used when this format is the UPSTREAM format and client is not this format)
  decodeResponse(body: string, status: number): { body: string; status: number };

  // Transform a non-streaming response FROM OpenAI format TO this format
  // (used when the client format is this format and upstream is not this format)
  encodeResponse(openaiBody: string, status: number): { body: string; status: number };

  // Transform streaming SSE events FROM this format TO OpenAI SSE format
  // (used when this format is the UPSTREAM format and client is not this format)
  // Receives pre-parsed SSE events from the upstream, emits OpenAI-format SSE events
  decodeStream(events: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent>;

  // Transform streaming SSE events FROM OpenAI SSE format TO this format's SSE
  // (used when the client format is this format and upstream is not this format)
  // Receives OpenAI-format SSE events, emits this format's SSE events
  encodeStream(openaiEvents: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent>;
}
```

### 3.3 Transformation Pipeline

For a request from client format **C** to upstream format **U**:

**Non-streaming:**
```
Client body (format C)
  → C.decodeRequest() → OpenAI intermediate
  → U.encodeRequest() → Upstream request

Upstream response (format U)
  → U.decodeResponse() → OpenAI intermediate
  → C.encodeResponse() → Client response (format C)
```

**Streaming:**
```
Client body (format C)
  → C.decodeRequest() → OpenAI intermediate
  → U.encodeRequest() → Upstream request

Upstream stream (format U SSE)
  → U.decodeStream() → OpenAI intermediate SSE
  → C.encodeStream() → Client stream (format C SSE)
```

### 3.4 Passthrough Optimization

When client format === upstream format:
- **Non-streaming**: No transformation needed. Pass request/response through directly.
- **Streaming**: No transformation needed. Pass stream through directly.

This avoids unnecessary serialization/deserialization for same-format requests.

## 4. Streaming Design

### 4.1 SSE Event Formats

**OpenAI streaming events:**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Anthropic streaming events:**
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","role":"assistant","content":[]}}

event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}

event: message_stop
data: {"type":"message_stop"}
```

**Gemini streaming events:**
```
data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"totalTokenCount":15}}

data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":15}}
```

### 4.2 Stream Transformer Interface

Each format implements `decodeStream` (upstream→OpenAI SSE) and `encodeStream` (OpenAI SSE→client format SSE).

The core streaming infrastructure:

```typescript
// Parse an upstream SSE byte stream into individual events
function parseSSEStream(upstream: ReadableStream<Uint8Array>): ReadableStream<SSEEvent>;

// Serialize SSE events back to bytes
function serializeSSEStream(events: ReadableStream<SSEEvent>): ReadableStream<Uint8Array>;

interface SSEEvent {
  event?: string;  // optional event type (Anthropic uses this)
  data: string;    // data payload
}
```

### 4.3 Stream Processing Pipeline

```
Upstream ReadableStream<Uint8Array>
  → parseSSEStream() → ReadableStream<SSEEvent>
  → U.decodeStream() → ReadableStream<SSEEvent> (OpenAI format events)
  → C.encodeStream() → ReadableStream<SSEEvent> (client format events)
  → serializeSSEStream() → ReadableStream<Uint8Array>
  → Response body
```

### 4.4 Token Extraction from Streams

For stats recording, extract token usage from the final streaming event:
- **OpenAI**: Last chunk before `[DONE]` may contain `usage` field
- **Anthropic**: `message_delta` event contains `usage.output_tokens`
- **Gemini**: Final event contains `usageMetadata.totalTokenCount`

Stats are recorded when the stream completes (not per-event).

### 4.5 Error Handling During Streaming

If the upstream stream breaks mid-transfer:
1. Emit an error event in the client's format
2. Close the stream gracefully

For OpenAI format:
```
data: {"error":{"message":"Upstream connection lost","type":"gateway_error"}}

data: [DONE]
```

For Anthropic format:
```
event: error
data: {"type":"error","error":{"type":"gateway_error","message":"Upstream connection lost"}}
```

For Gemini format:
```
data: {"error":{"code":502,"message":"Upstream connection lost","status":"INTERNAL"}}
```

### 4.6 Non-Streaming Requests

Non-streaming requests (where `stream` is absent or `false`) continue to work through the existing proxy path with the added bidirectional transformation. The existing transformer methods are renamed but their logic remains:

| Current Method | New Method | Purpose |
|---|---|---|
| `transformRequest()` | `encodeRequest()` | OpenAI → upstream format |
| `transformResponse()` | `decodeResponse()` | Upstream format → OpenAI |

New methods added: `decodeRequest()` and `encodeResponse()` for the reverse direction.

## 5. Route Implementation

### 5.1 Route Handlers

```typescript
// /v1/chat/completions — backward compatible, OpenAI format
proxyRoutes.post('/chat/completions', handleProxy('openai'));

// /v1/openai/chat/completions — explicit OpenAI format
openaiProxyRoutes.post('/chat/completions', handleProxy('openai'));

// /v1/anthropic/messages — Anthropic format
anthropicProxyRoutes.post('/messages', handleProxy('anthropic'));

// /v1/gemini/models/:model:generateContent — Gemini format
geminiProxyRoutes.post('/models/:model\\:generateContent', handleProxy('gemini'));
```

### 5.2 Universal Proxy Handler

```typescript
async function handleProxy(clientFormat: string) {
  return async (c: Context) => {
    const auth = c.get('auth');
    const rawBody = await c.req.json();
    const clientTransformer = transformers[clientFormat];

    // Step 1: Decode client request to OpenAI intermediate format
    const openaiRequest = clientTransformer.decodeRequest(rawBody);

    // Step 2: Route (uses OpenAI intermediate format)
    const route = await routeRequest(env, keyId, openaiRequest);

    // Step 3: Encode to upstream format
    const upstreamTransformer = transformers[endpoint.format];
    const transformed = upstreamTransformer.encodeRequest(openaiRequest, model.real_model, endpoint.api_key);

    // Step 4: Forward to upstream
    const response = await fetch(fullUrl, { method: 'POST', headers: transformed.headers, body: transformed.body });

    // Step 5: Transform response
    if (openaiRequest.stream) {
      // Streaming path
      if (clientFormat === endpoint.format) {
        // Passthrough — no transformation needed
        return new Response(response.body!, { headers: streamHeaders(clientFormat) });
      }
      // Parse upstream SSE → decode to OpenAI events → encode to client events → serialize
      const upstreamEvents = parseSSEStream(response.body!);
      const openaiEvents = upstreamTransformer.decodeStream(upstreamEvents, model.real_model);
      const clientEvents = clientTransformer.encodeStream(openaiEvents, model.real_model);
      const clientStream = serializeSSEStream(clientEvents);
      return new Response(clientStream, { headers: streamHeaders(clientFormat) });
    } else {
      // Non-streaming path
      const responseBody = await response.text();
      if (clientFormat === endpoint.format) {
        // Passthrough
        return c.json(JSON.parse(responseBody), response.status as ContentfulStatusCode);
      }
      const { body: openaiBody, status } = upstreamTransformer.decodeResponse(responseBody, response.status);
      const { body: clientBody } = clientTransformer.encodeResponse(openaiBody, status);
      return c.json(JSON.parse(clientBody), status as ContentfulStatusCode);
    }
  };
}
```

### 5.3 Stream Response Headers

| Client Format | Content-Type | Other Headers |
|---|---|---|
| OpenAI | `text/event-stream` | `Cache-Control: no-cache`, `Connection: keep-alive` |
| Anthropic | `text/event-stream` | `Cache-Control: no-cache`, `Connection: keep-alive` |
| Gemini | `text/event-stream` | `Cache-Control: no-cache`, `Connection: keep-alive` |

All formats use SSE (`text/event-stream`).

## 6. Anthropic Request/Response Format Details

### 6.1 Anthropic Request (for decodeRequest/encodeResponse)

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "system": "You are helpful",
  "stream": true,
  "temperature": 0.7
}
```

### 6.2 Anthropic Response (for encodeResponse/decodeStream)

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello!" }],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 10, "output_tokens": 5 }
}
```

### 6.3 Anthropic → OpenAI Request Mapping

| Anthropic | OpenAI |
|---|---|
| `system` (string) | `messages[0].role = "system"` |
| `messages[].content` (string) | `messages[].content` (string) |
| `messages[].content` (array of content blocks) | `messages[].content` (array of OpenAI content parts) |
| `max_tokens` | `max_tokens` |
| `stop_sequences` | `stop` |
| `temperature` | `temperature` |
| `top_p` | `top_p` |
| `stream` | `stream` |

### 6.4 OpenAI → Anthropic Response Mapping

| OpenAI | Anthropic |
|---|---|
| `choices[0].message.content` | `content: [{ type: "text", text: ... }]` |
| `choices[0].finish_reason` | `stop_reason` (mapped: "stop"→"end_turn", "length"→"max_tokens") |
| `usage.prompt_tokens` | `usage.input_tokens` |
| `usage.completion_tokens` | `usage.output_tokens` |
| `model` | `model` |

## 7. Gemini Request/Response Format Details

### 7.1 Gemini Request (for decodeRequest/encodeResponse)

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello" }] }
  ],
  "systemInstruction": { "parts": [{ "text": "You are helpful" }] },
  "generationConfig": {
    "maxOutputTokens": 4096,
    "temperature": 0.7
  }
}
```

### 7.2 Gemini Response (for encodeResponse/decodeStream)

```json
{
  "candidates": [{
    "content": { "parts": [{ "text": "Hello!" }], "role": "model" },
    "finishReason": "STOP"
  }],
  "usageMetadata": {
    "promptTokenCount": 10,
    "candidatesTokenCount": 5,
    "totalTokenCount": 15
  },
  "modelVersion": "gemini-2.5-flash"
}
```

### 7.3 Gemini → OpenAI Request Mapping

| Gemini | OpenAI |
|---|---|
| `systemInstruction.parts[].text` | `messages[0].role = "system"` |
| `contents[].role = "user"` | `messages[].role = "user"` |
| `contents[].role = "model"` | `messages[].role = "assistant"` |
| `parts[].text` | `content` (string or array) |
| `parts[].inline_data` | `content[].image_url` (data: URL) |
| `parts[].file_data` | `content[].image_url` (regular URL) |
| `generationConfig.maxOutputTokens` | `max_tokens` |
| `generationConfig.temperature` | `temperature` |
| `generationConfig.topP` | `top_p` |

### 7.4 OpenAI → Gemini Response Mapping

| OpenAI | Gemini |
|---|---|
| `choices[0].message.content` | `candidates[0].content.parts[{ text }]` |
| `choices[0].finish_reason` | `finishReason` (mapped: "stop"→"STOP", "length"→"MAX_TOKENS") |
| `usage.prompt_tokens` | `usageMetadata.promptTokenCount` |
| `usage.completion_tokens` | `usageMetadata.candidatesTokenCount` |
| `usage.total_tokens` | `usageMetadata.totalTokenCount` |
| `model` | `modelVersion` |

## 8. File Changes

### New Files
- `src/utils/sse.ts` — SSE parsing and serialization utilities

### Modified Files
- `src/transformer/types.ts` — Revised Transformer interface with bidirectional methods
- `src/transformer/openai.ts` — Add `decodeRequest`, `encodeResponse`, `decodeStream`, `encodeStream`
- `src/transformer/anthropic.ts` — Add `decodeRequest`, `encodeResponse`, `decodeStream`, `encodeStream`
- `src/transformer/gemini.ts` — Add `decodeRequest`, `encodeResponse`, `decodeStream`, `encodeStream`
- `src/services/proxy.ts` — Refactor to support multi-format routing with streaming
- `src/routes/proxy.ts` — Add `/v1/openai/`, `/v1/anthropic/`, `/v1/gemini/` routes
- `src/index.ts` — Wire new routes

### Unchanged Files
- All auth, key, endpoint, binding, stats, billing, and middleware files remain unchanged
- `src/router/` unchanged (routing operates on OpenAI intermediate format)
- `src/utils/tokens.ts` unchanged
- `src/data/presets.ts` unchanged

## 9. Migration Notes

- The existing `POST /v1/chat/completions` route continues to work exactly as before (OpenAI format in/out)
- The existing `transformRequest` and `transformResponse` methods are renamed to `encodeRequest` and `decodeResponse` — their logic is preserved
- All other routes (auth, keys, endpoints, bindings, stats, billing, models) are unaffected
- The router still operates on the OpenAI intermediate format internally — only the proxy layer changes
