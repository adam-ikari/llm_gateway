# Multi-Format Gateway with Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the LLM gateway to accept requests in OpenAI, Anthropic, or Gemini format via path-based routing, transform bidirectionally between any pair of formats, and support streaming (SSE) for all 9 format combinations.

**Architecture:** Clients choose their format via route path (`/v1/openai/`, `/v1/anthropic/`, `/v1/gemini/`). Each transformer implements 6 methods: `decodeRequest` (format→OpenAI), `encodeRequest` (OpenAI→format), `decodeResponse` (format→OpenAI), `encodeResponse` (OpenAI→format), `decodeStream` (format SSE→OpenAI SSE), `encodeStream` (OpenAI SSE→format SSE). The proxy service orchestrates the two-step transform (client→OpenAI→upstream for requests, upstream→OpenAI→client for responses). SSE utility functions parse/serialize streams.

**Tech Stack:** Cloudflare Workers, KV, TypeScript, Hono, Web Streams API

---

## File Structure

```
src/
├── utils/
│   └── sse.ts                    # NEW — SSE parsing and serialization utilities
├── types.ts                      # MODIFY — add SSEEvent type
├── transformer/
│   ├── types.ts                  # MODIFY — revised Transformer interface with 6 methods
│   ├── openai.ts                 # REWRITE — add decodeRequest, encodeResponse, decodeStream, encodeStream
│   ├── anthropic.ts              # REWRITE — add decodeRequest, encodeResponse, decodeStream, encodeStream
│   └── gemini.ts                 # REWRITE — add decodeRequest, encodeResponse, decodeStream, encodeStream
├── services/
│   └── proxy.ts                  # REWRITE — multi-format proxy with streaming support
├── routes/
│   └── proxy.ts                  # REWRITE — multi-format route handlers
└── index.ts                      # MODIFY — wire new routes
```

### Task Dependency Order

```
Task 1 (SSEEvent type) → Task 2 (SSE utils) → Task 3 (Transformer interface)
→ Task 4 (OpenAI transformer) → Task 5 (Anthropic transformer)
→ Task 6 (Gemini transformer) → Task 7 (Proxy service)
→ Task 8 (Proxy routes) → Task 9 (Route wiring) → Task 10 (Final typecheck)
```

---

### Task 1: Add SSEEvent Type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add SSEEvent interface to src/types.ts**

Add the following at the end of `src/types.ts`, after the `RouteResult` interface:

```typescript
// ========== SSE Streaming ==========

export interface SSEEvent {
  event?: string;
  data: string;
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
git commit -m "feat: add SSEEvent type for streaming support"
```

---

### Task 2: SSE Parsing and Serialization Utilities

**Files:**
- Create: `src/utils/sse.ts`

- [ ] **Step 1: Write src/utils/sse.ts**

```typescript
import type { SSEEvent } from '../types';

/**
 * Parse a ReadableStream<Uint8Array> of SSE bytes into individual SSEEvent objects.
 * Handles multi-line data fields, event types, and comments.
 */
export function parseSSEStream(upstream: ReadableStream<Uint8Array>): ReadableStream<SSEEvent> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream<SSEEvent>({
    async pull(controller) {
      while (true) {
        // Try to extract a complete event from the buffer
        const eventEnd = buffer.indexOf('\n\n');
        if (eventEnd !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          const event = parseSingleEvent(rawEvent);
          if (event) {
            controller.enqueue(event);
            return;
          }
          continue; // Skip empty/comment-only events and try again
        }

        // Need more data
        const { value, done } = await reader.read();
        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            const event = parseSingleEvent(buffer);
            if (event) controller.enqueue(event);
          }
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

function parseSingleEvent(raw: string): SSEEvent | null {
  const lines = raw.split('\n');
  let eventType: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) continue; // comment, skip
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart()); // preserve leading space if present
    } else if (line.includes(':')) {
      // Unknown field, skip
    }
  }

  if (dataLines.length === 0) return null;
  return { event: eventType, data: dataLines.join('\n') };
}

/**
 * Serialize a ReadableStream<SSEEvent> into a ReadableStream<Uint8Array> of SSE bytes.
 */
export function serializeSSEStream(events: ReadableStream<SSEEvent>): ReadableStream<Uint8Array> {
  const reader = events.getReader();
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(serializeSingleEvent(value)));
    },
    cancel() {
      reader.cancel();
    },
  });
}

function serializeSingleEvent(event: SSEEvent): string {
  let out = '';
  if (event.event) {
    out += `event: ${event.event}\n`;
  }
  // Split data by newlines — each line gets its own data: prefix
  const dataLines = event.data.split('\n');
  for (const line of dataLines) {
    out += `data: ${line}\n`;
  }
  out += '\n';
  return out;
}

/**
 * Create a streaming Response with proper SSE headers.
 */
export function streamHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/sse.ts
git commit -m "feat: add SSE stream parsing and serialization utilities"
```

---

### Task 3: Revise Transformer Interface

**Files:**
- Modify: `src/transformer/types.ts`

- [ ] **Step 1: Rewrite src/transformer/types.ts with the new bidirectional interface**

```typescript
import type { OpenAIRequest, TransformedRequest, SSEEvent } from '../types';

export interface Transformer {
  format: string;

  /**
   * Transform a request FROM this format TO OpenAI intermediate format.
   * Used when this format is the CLIENT format.
   */
  decodeRequest(body: unknown): OpenAIRequest;

  /**
   * Transform a request FROM OpenAI intermediate format TO this format.
   * Used when this format is the UPSTREAM format.
   */
  encodeRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest;

  /**
   * Transform a non-streaming response FROM this format TO OpenAI format.
   * Used when this format is the UPSTREAM format and client is not this format.
   */
  decodeResponse(body: string, status: number): { body: string; status: number };

  /**
   * Transform a non-streaming response FROM OpenAI format TO this format.
   * Used when the client format is this format and upstream is not this format.
   */
  encodeResponse(openaiBody: string, status: number): { body: string; status: number };

  /**
   * Transform streaming SSE events FROM this format TO OpenAI SSE format.
   * Used when this format is the UPSTREAM format and client is not this format.
   */
  decodeStream(events: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent>;

  /**
   * Transform streaming SSE events FROM OpenAI SSE format TO this format's SSE.
   * Used when the client format is this format and upstream is not this format.
   */
  encodeStream(openaiEvents: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent>;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: Errors in openai.ts, anthropic.ts, gemini.ts, proxy.ts because they still use the old interface. This is expected — we fix them in Tasks 4-7.

- [ ] **Step 3: Commit**

```bash
git add src/transformer/types.ts
git commit -m "feat: revise Transformer interface with bidirectional methods"
```

---

### Task 4: Rewrite OpenAI Transformer

**Files:**
- Modify: `src/transformer/openai.ts`

The OpenAI transformer is the simplest: all methods are passthrough or identity transforms since the intermediate format IS OpenAI format.

- [ ] **Step 1: Rewrite src/transformer/openai.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, TransformedRequest, SSEEvent } from '../types';

export const openaiTransformer: Transformer = {
  format: 'openai',

  decodeRequest(body: unknown): OpenAIRequest {
    // Client is sending OpenAI format — it's already in the intermediate format
    return body as OpenAIRequest;
  },

  encodeRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const body = { ...req, model: realModel };
    return {
      url: '',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
  },

  decodeResponse(body: string, status: number): { body: string; status: number } {
    // Upstream is OpenAI format — already in intermediate format
    return { body, status };
  },

  encodeResponse(openaiBody: string, status: number): { body: string; status: number } {
    // Client wants OpenAI format — intermediate format IS OpenAI format
    return { body: openaiBody, status };
  },

  decodeStream(events: ReadableStream<SSEEvent>, _model: string): ReadableStream<SSEEvent> {
    // Upstream is OpenAI SSE — already in intermediate format
    return events;
  },

  encodeStream(openaiEvents: ReadableStream<SSEEvent>, _model: string): ReadableStream<SSEEvent> {
    // Client wants OpenAI SSE — intermediate format IS OpenAI format
    return openaiEvents;
  },
};
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Still errors in anthropic.ts, gemini.ts, proxy.ts — openai.ts should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/transformer/openai.ts
git commit -m "feat: rewrite OpenAI transformer with bidirectional methods"
```

---

### Task 5: Rewrite Anthropic Transformer

**Files:**
- Modify: `src/transformer/anthropic.ts`

This is the most complex transformer. It needs:
- `decodeRequest`: Anthropic → OpenAI request
- `encodeRequest`: OpenAI → Anthropic request (existing logic from `transformRequest`)
- `decodeResponse`: Anthropic → OpenAI response (existing logic from `transformResponse`)
- `encodeResponse`: OpenAI → Anthropic response (new)
- `decodeStream`: Anthropic SSE → OpenAI SSE (new)
- `encodeStream`: OpenAI SSE → Anthropic SSE (new)

- [ ] **Step 1: Rewrite src/transformer/anthropic.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, OpenAIMessage, OpenAIContentPart, TransformedRequest, SSEEvent } from '../types';

export const anthropicTransformer: Transformer = {
  format: 'anthropic',

  // ========== Client → OpenAI intermediate ==========

  decodeRequest(body: unknown): OpenAIRequest {
    const b = body as Record<string, unknown>;
    const messages: OpenAIMessage[] = [];

    // Extract system prompt and prepend as system message
    if (typeof b.system === 'string' && b.system) {
      messages.push({ role: 'system', content: b.system });
    }

    // Convert Anthropic messages to OpenAI messages
    const anthropicMessages = (b.messages || []) as Array<Record<string, unknown>>;
    for (const msg of anthropicMessages) {
      const role = msg.role as string;
      if (role === 'system') {
        messages.push({ role: 'system', content: String(msg.content) });
        continue;
      }
      const openaiRole = role === 'assistant' ? 'assistant' : 'user';
      const content = msg.content;
      if (typeof content === 'string') {
        messages.push({ role: openaiRole as OpenAIMessage['role'], content });
      } else if (Array.isArray(content)) {
        const parts: OpenAIContentPart[] = [];
        for (const block of content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text || '' });
          } else if (block.type === 'image' && block.source) {
            const src = block.source as Record<string, string>;
            if (src.type === 'url') {
              parts.push({ type: 'image_url', image_url: { url: src.url } });
            } else if (src.type === 'base64') {
              const dataUrl = `data:${src.media_type};base64,${src.data}`;
              parts.push({ type: 'image_url', image_url: { url: dataUrl } });
            }
          }
        }
        messages.push({ role: openaiRole as OpenAIMessage['role'], content: parts });
      }
    }

    const request: OpenAIRequest = {
      model: b.model as string,
      messages,
    };

    if (b.max_tokens !== undefined) request.max_tokens = b.max_tokens as number;
    if (b.temperature !== undefined) request.temperature = b.temperature as number;
    if (b.top_p !== undefined) request.top_p = b.top_p as number;
    if (b.stream !== undefined) request.stream = b.stream as boolean;
    if (b.stop_sequences) request.tools = undefined; // stop_sequences not directly mappable

    return request;
  },

  // ========== OpenAI intermediate → Anthropic upstream ==========

  encodeRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const systemMessages: string[] = [];
    const messages: Array<{ role: string; content: unknown }> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        systemMessages.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        continue;
      }

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
              source: { type: 'url', url: part.image_url.url },
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

  // ========== Anthropic upstream → OpenAI intermediate ==========

  decodeResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const resp = JSON.parse(body);
      const usage = resp.usage || {};
      const openaiResp: OpenAIResponse = {
        id: resp.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: resp.model || '',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: extractText(resp.content),
          },
          finish_reason: mapStopReason(resp.stop_reason),
        }],
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

  // ========== OpenAI intermediate → Anthropic client ==========

  encodeResponse(openaiBody: string, status: number): { body: string; status: number } {
    try {
      const resp = JSON.parse(openaiBody) as OpenAIResponse;
      const content = resp.choices?.[0]?.message?.content;
      const finishReason = resp.choices?.[0]?.finish_reason;

      const anthropicResp = {
        id: resp.id || `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: content || '' }],
        model: resp.model || '',
        stop_reason: mapFinishReasonToAnthropic(finishReason),
        stop_sequence: null,
        usage: {
          input_tokens: resp.usage?.prompt_tokens || 0,
          output_tokens: resp.usage?.completion_tokens || 0,
        },
      };

      return { body: JSON.stringify(anthropicResp), status };
    } catch {
      return { body: openaiBody, status };
    }
  },

  // ========== Anthropic SSE → OpenAI SSE ==========

  decodeStream(events: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent> {
    const reader = events.getReader();
    let msgId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    let inputTokens = 0;

    return new ReadableStream<SSEEvent>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue({ data: '[DONE]' });
          controller.close();
          return;
        }

        const eventType = value.event;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(value.data);
        } catch {
          return; // skip unparseable events
        }

        switch (eventType) {
          case 'message_start': {
            const msg = (data as { message?: Record<string, unknown> }).message;
            if (msg?.id) msgId = `chatcmpl-${msg.id}`;
            inputTokens = ((msg?.usage as Record<string, number>)?.input_tokens) || 0;
            // Emit initial role chunk
            controller.enqueue({
              data: JSON.stringify({
                id: msgId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
              }),
            });
            break;
          }
          case 'content_block_delta': {
            const delta = data as { delta?: { type?: string; text?: string } };
            const text = delta.delta?.text || '';
            if (text) {
              controller.enqueue({
                data: JSON.stringify({
                  id: msgId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
                }),
              });
            }
            break;
          }
          case 'message_delta': {
            const d = data as { delta?: { stop_reason?: string }; usage?: { output_tokens?: number } };
            controller.enqueue({
              data: JSON.stringify({
                id: msgId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(d.delta?.stop_reason) }],
                usage: {
                  prompt_tokens: inputTokens,
                  completion_tokens: d.usage?.output_tokens || 0,
                  total_tokens: inputTokens + (d.usage?.output_tokens || 0),
                },
              }),
            });
            break;
          }
          case 'message_stop':
          case 'content_block_stop':
          case 'content_block_start':
            // Skip — no content to emit
            break;
          case 'ping':
            // Skip keepalive
            break;
          case 'error': {
            controller.enqueue({
              data: JSON.stringify({
                error: { message: (data as { error?: { message?: string } }).error?.message || 'Upstream error', type: 'upstream_error' },
              }),
            });
            controller.enqueue({ data: '[DONE]' });
            controller.close();
            return;
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  },

  // ========== OpenAI SSE → Anthropic SSE ==========

  encodeStream(openaiEvents: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent> {
    const reader = openaiEvents.getReader();
    let outputTokens = 0;
    let started = false;

    return new ReadableStream<SSEEvent>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          // Emit final events
          controller.enqueue({
            event: 'message_delta',
            data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } }),
          });
          controller.enqueue({ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) });
          controller.close();
          return;
        }

        if (value.data === '[DONE]') {
          // We'll emit final events on the next pull (done=true)
          // But close now since [DONE] means stream is ending
          controller.enqueue({
            event: 'message_delta',
            data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } }),
          });
          controller.enqueue({ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) });
          controller.close();
          return;
        }

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(value.data);
        } catch {
          return; // skip unparseable
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;

        if (!started) {
          // Emit message_start
          controller.enqueue({
            event: 'message_start',
            data: JSON.stringify({
              type: 'message_start',
              message: {
                id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          });
          // Emit content_block_start
          controller.enqueue({
            event: 'content_block_start',
            data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          });
          started = true;
        }

        if (delta?.content && typeof delta.content === 'string') {
          outputTokens += 1; // approximate
          controller.enqueue({
            event: 'content_block_delta',
            data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } }),
          });
        }

        const finishReason = choices?.[0]?.finish_reason as string | undefined;
        if (finishReason) {
          // Emit content_block_stop
          controller.enqueue({
            event: 'content_block_stop',
            data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
          });
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  },
};

// ========== Helpers ==========

function extractText(content: Array<{ type: string; text?: string }>): string {
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    case 'tool_use': return 'tool_calls';
    default: return reason || 'stop';
  }
}

function mapFinishReasonToAnthropic(reason: string | undefined): string {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    default: return 'end_turn';
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Errors only in gemini.ts and proxy.ts — anthropic.ts should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/transformer/anthropic.ts
git commit -m "feat: rewrite Anthropic transformer with bidirectional and streaming support"
```

---

### Task 6: Rewrite Gemini Transformer

**Files:**
- Modify: `src/transformer/gemini.ts`

- [ ] **Step 1: Rewrite src/transformer/gemini.ts**

```typescript
import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, OpenAIMessage, OpenAIContentPart, TransformedRequest, SSEEvent } from '../types';

export const geminiTransformer: Transformer = {
  format: 'gemini',

  // ========== Client → OpenAI intermediate ==========

  decodeRequest(body: unknown): OpenAIRequest {
    const b = body as Record<string, unknown>;
    const messages: OpenAIMessage[] = [];

    // Extract system instruction
    const sysInstr = b.systemInstruction as { parts?: Array<{ text?: string }> } | undefined;
    if (sysInstr?.parts) {
      const sysText = sysInstr.parts.map((p) => p.text || '').join('\n');
      if (sysText) messages.push({ role: 'system', content: sysText });
    }

    // Convert Gemini contents to OpenAI messages
    const contents = (b.contents || []) as Array<Record<string, unknown>>;
    for (const entry of contents) {
      const geminiRole = entry.role as string;
      const openaiRole = geminiRole === 'model' ? 'assistant' : 'user';
      const parts = (entry.parts || []) as Array<Record<string, unknown>>;

      if (parts.length === 1 && parts[0].text && !parts[0].inline_data && !parts[0].file_data) {
        messages.push({ role: openaiRole as OpenAIMessage['role'], content: parts[0].text as string });
      } else {
        const contentParts: OpenAIContentPart[] = [];
        let hasNonText = false;
        for (const part of parts) {
          if (part.text) {
            contentParts.push({ type: 'text', text: part.text as string });
          } else if (part.inline_data) {
            hasNonText = true;
            const id = part.inline_data as { mime_type?: string; data?: string };
            contentParts.push({
              type: 'image_url',
              image_url: { url: `data:${id.mime_type || 'image/jpeg'};base64,${id.data || ''}` },
            });
          } else if (part.file_data) {
            hasNonText = true;
            const fd = part.file_data as { file_uri?: string; mime_type?: string };
            contentParts.push({
              type: 'image_url',
              image_url: { url: fd.file_uri || '' },
            });
          }
        }
        if (hasNonText || contentParts.length > 1) {
          messages.push({ role: openaiRole as OpenAIMessage['role'], content: contentParts });
        } else if (contentParts.length === 1 && contentParts[0].type === 'text') {
          messages.push({ role: openaiRole as OpenAIMessage['role'], content: contentParts[0].text });
        }
      }
    }

    const genConfig = b.generationConfig as Record<string, unknown> | undefined;

    const request: OpenAIRequest = {
      model: '', // Gemini doesn't include model in body; it's in the URL
      messages,
    };

    if (genConfig?.maxOutputTokens !== undefined) request.max_tokens = genConfig.maxOutputTokens as number;
    if (genConfig?.temperature !== undefined) request.temperature = genConfig.temperature as number;
    if (genConfig?.topP !== undefined) request.top_p = genConfig.topP as number;

    return request;
  },

  // ========== OpenAI intermediate → Gemini upstream ==========

  encodeRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const systemInstructions: string[] = [];
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

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
            if (part.image_url.url.startsWith('data:')) {
              const [mimePart, data] = part.image_url.url.split(';base64,');
              const mimeType = mimePart.replace('data:', '');
              parts.push({ inline_data: { mime_type: mimeType, data } });
            } else {
              parts.push({
                file_data: {
                  mime_type: guessMimeType(part.image_url.url),
                  file_uri: part.image_url.url,
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
      generationConfig: { maxOutputTokens: req.max_tokens ?? 4096 },
    };

    if (systemInstructions.length > 0) {
      body.systemInstruction = { parts: [{ text: systemInstructions.join('\n') }] };
    }

    return {
      url: `/v1beta/models/${realModel}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    };
  },

  // ========== Gemini upstream → OpenAI intermediate ==========

  decodeResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const resp = JSON.parse(body);
      const candidates = resp.candidates || [];
      const first = candidates[0]?.content?.parts || [];
      const text = first.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join('\n');

      const openaiResp: OpenAIResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: resp.modelVersion || '',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: mapGeminiFinishReason(candidates[0]?.finishReason),
        }],
        usage: {
          prompt_tokens: resp.usageMetadata?.promptTokenCount || 0,
          completion_tokens: resp.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: resp.usageMetadata?.totalTokenCount || 0,
        },
      };

      return { body: JSON.stringify(openaiResp), status: 200 };
    } catch {
      return { body, status };
    }
  },

  // ========== OpenAI intermediate → Gemini client ==========

  encodeResponse(openaiBody: string, status: number): { body: string; status: number } {
    try {
      const resp = JSON.parse(openaiBody) as OpenAIResponse;
      const content = resp.choices?.[0]?.message?.content;
      const finishReason = resp.choices?.[0]?.finish_reason;

      const geminiResp = {
        candidates: [{
          content: {
            parts: [{ text: content || '' }],
            role: 'model',
          },
          finishReason: mapFinishReasonToGemini(finishReason),
        }],
        usageMetadata: {
          promptTokenCount: resp.usage?.prompt_tokens || 0,
          candidatesTokenCount: resp.usage?.completion_tokens || 0,
          totalTokenCount: resp.usage?.total_tokens || 0,
        },
        modelVersion: resp.model || '',
      };

      return { body: JSON.stringify(geminiResp), status };
    } catch {
      return { body: openaiBody, status };
    }
  },

  // ========== Gemini SSE → OpenAI SSE ==========

  decodeStream(events: ReadableStream<SSEEvent>, model: string): ReadableStream<SSEEvent> {
    const reader = events.getReader();
    const msgId = `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

    return new ReadableStream<SSEEvent>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.enqueue({ data: '[DONE]' });
          controller.close();
          return;
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(value.data);
        } catch {
          return; // skip unparseable
        }

        // Check for error
        if (data.error) {
          controller.enqueue({
            data: JSON.stringify({
              error: { message: (data.error as Record<string, string>).message || 'Upstream error', type: 'upstream_error' },
            }),
          });
          controller.enqueue({ data: '[DONE]' });
          controller.close();
          return;
        }

        const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
        const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as Array<Record<string, unknown>> | undefined;
        const finishReason = candidates?.[0]?.finishReason as string | undefined;
        const usageMeta = data.usageMetadata as Record<string, number> | undefined;

        // Extract text delta
        const textParts = (parts || []).filter((p) => p.text) as Array<{ text: string }>;
        const text = textParts.map((p) => p.text).join('');

        if (text) {
          controller.enqueue({
            data: JSON.stringify({
              id: msgId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            }),
          });
        }

        if (finishReason) {
          controller.enqueue({
            data: JSON.stringify({
              id: msgId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: mapGeminiFinishReason(finishReason) }],
              usage: {
                prompt_tokens: usageMeta?.promptTokenCount || 0,
                completion_tokens: usageMeta?.candidatesTokenCount || 0,
                total_tokens: usageMeta?.totalTokenCount || 0,
              },
            }),
          });
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  },

  // ========== OpenAI SSE → Gemini SSE ==========

  encodeStream(openaiEvents: ReadableStream<SSEEvent>, _model: string): ReadableStream<SSEEvent> {
    const reader = openaiEvents.getReader();

    return new ReadableStream<SSEEvent>({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        if (value.data === '[DONE]') {
          // Gemini doesn't have a [DONE] signal — just close
          controller.close();
          return;
        }

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(value.data);
        } catch {
          return; // skip unparseable
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
        const finishReason = choices?.[0]?.finish_reason as string | undefined;
        const usage = chunk.usage as Record<string, number> | undefined;

        const parts: Array<Record<string, unknown>> = [];

        if (delta?.content && typeof delta.content === 'string') {
          parts.push({ text: delta.content });
        }

        const geminiChunk: Record<string, unknown> = {};

        if (parts.length > 0) {
          geminiChunk.candidates = [{
            content: { parts, role: 'model' },
          }];
        }

        if (finishReason) {
          if (!geminiChunk.candidates) {
            geminiChunk.candidates = [{ content: { parts: [], role: 'model' } }];
          }
          (geminiChunk.candidates as Array<Record<string, unknown>>)[0].finishReason = mapFinishReasonToGemini(finishReason);
        }

        if (usage) {
          geminiChunk.usageMetadata = {
            promptTokenCount: usage.prompt_tokens || 0,
            candidatesTokenCount: usage.completion_tokens || 0,
            totalTokenCount: usage.total_tokens || 0,
          };
        }

        if (Object.keys(geminiChunk).length > 0) {
          controller.enqueue({ data: JSON.stringify(geminiChunk) });
        }
      },
      cancel() {
        reader.cancel();
      },
    });
  },
};

// ========== Helpers ==========

function mapGeminiFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    default: return reason || 'stop';
  }
}

function mapFinishReasonToGemini(reason: string | undefined): string {
  switch (reason) {
    case 'stop': return 'STOP';
    case 'length': return 'MAX_TOKENS';
    case 'content_filter': return 'SAFETY';
    default: return 'STOP';
  }
}

function guessMimeType(url: string): string {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return mimeMap[ext] || 'image/jpeg';
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Errors only in proxy.ts and routes/proxy.ts — gemini.ts should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/transformer/gemini.ts
git commit -m "feat: rewrite Gemini transformer with bidirectional and streaming support"
```

---

### Task 7: Rewrite Proxy Service

**Files:**
- Modify: `src/services/proxy.ts`

The proxy service now handles multi-format routing with streaming. It exports a single `proxyRequest` function that takes a `clientFormat` parameter and handles both streaming and non-streaming paths with bidirectional transformation.

- [ ] **Step 1: Rewrite src/services/proxy.ts**

```typescript
import type { Env } from '../index';
import type { OpenAIRequest, TransformedRequest, SSEEvent } from '../types';
import type { Transformer } from '../transformer/types';
import { openaiTransformer } from '../transformer/openai';
import { anthropicTransformer } from '../transformer/anthropic';
import { geminiTransformer } from '../transformer/gemini';
import { routeRequest } from '../router/index';
import { recordStats } from './stats';
import { parseSSEStream, serializeSSEStream, streamHeaders } from '../utils/sse';

const transformers: Record<string, Transformer> = {
  openai: openaiTransformer,
  anthropic: anthropicTransformer,
  gemini: geminiTransformer,
};

export { transformers, streamHeaders };

export type ProxyOutcome =
  | { type: 'json'; status: number; body: unknown }
  | { type: 'stream'; stream: ReadableStream<Uint8Array>; status: number }
  | { type: 'error'; status: number; body: unknown };

export async function proxyRequest(
  env: Env,
  keyId: string,
  userId: string,
  clientFormat: string,
  rawBody: unknown,
): Promise<ProxyOutcome> {
  const clientTransformer = transformers[clientFormat];
  if (!clientTransformer) {
    return { type: 'error', status: 400, body: { error: { message: `Unsupported client format: ${clientFormat}`, type: 'invalid_request' } } };
  }

  // Step 1: Decode client request to OpenAI intermediate format
  let openaiRequest: OpenAIRequest;
  try {
    openaiRequest = clientTransformer.decodeRequest(rawBody);
  } catch (e) {
    return { type: 'error', status: 400, body: { error: { message: `Invalid request body for format ${clientFormat}: ${e instanceof Error ? e.message : 'parse error'}`, type: 'invalid_request' } } };
  }

  if (!openaiRequest.model || !openaiRequest.messages || !Array.isArray(openaiRequest.messages)) {
    return { type: 'error', status: 400, body: { error: { message: 'model and messages are required', type: 'invalid_request' } } };
  }

  // Step 2: Route
  const route = await routeRequest(env, keyId, openaiRequest);
  if ('type' in route) {
    const errorStatus = route.type === 'context_too_long' ? 400 : 404;
    return { type: 'error', status: errorStatus, body: { error: { message: route.message, type: route.type, ...(route.extra || {}) } } };
  }

  const { endpoint, model } = route;
  const upstreamTransformer = transformers[endpoint.format];
  if (!upstreamTransformer) {
    return { type: 'error', status: 500, body: { error: { message: `Unsupported upstream format: ${endpoint.format}`, type: 'internal_error' } } };
  }

  // Step 3: Encode to upstream format
  const transformed = upstreamTransformer.encodeRequest(openaiRequest, model.real_model, endpoint.api_key);
  const fullUrl = endpoint.base_url.replace(/\/$/, '') + transformed.url;

  // Step 4: Forward to upstream
  const isStreaming = !!openaiRequest.stream;
  const fetchHeaders: Record<string, string> = { ...transformed.headers };

  const startTime = Date.now();
  let response: Response;
  try {
    response = await fetch(fullUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: transformed.body,
    });
  } catch {
    return { type: 'error', status: 502, body: { error: { message: 'Upstream timeout or connection error', type: 'gateway_error' } } };
  }

  const responseTimeMs = Date.now() - startTime;

  // Step 5: Transform response
  const isPassthrough = clientFormat === endpoint.format;

  if (isStreaming && response.body) {
    if (isPassthrough) {
      // Passthrough streaming — no transformation
      void recordStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status);
      return { type: 'stream', stream: response.body, status: response.status };
    }

    // Transform streaming: upstream SSE → decode → encode → client SSE
    const upstreamEvents = parseSSEStream(response.body);
    const openaiEvents = upstreamTransformer.decodeStream(upstreamEvents, model.real_model);
    const clientEvents = clientTransformer.encodeStream(openaiEvents, model.real_model);
    const clientStream = serializeSSEStream(clientEvents);

    void recordStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status);
    return { type: 'stream', stream: clientStream, status: response.status };
  }

  // Non-streaming path
  const responseBody = await response.text();

  if (isPassthrough) {
    let parsedBody: unknown;
    try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = responseBody; }
    void recordNonStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, response.status, parsedBody);
    return { type: 'json', status: response.status, body: parsedBody };
  }

  const { body: openaiBody, status } = upstreamTransformer.decodeResponse(responseBody, response.status);
  const { body: clientBody } = clientTransformer.encodeResponse(openaiBody, status);

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(clientBody); } catch { parsedBody = clientBody; }

  void recordNonStreamStats(env, userId, keyId, openaiRequest.model, responseTimeMs, status, parsedBody);

  return { type: 'json', status, body: parsedBody };
}

async function recordNonStreamStats(env: Env, userId: string, keyId: string, modelName: string, responseTimeMs: number, statusCode: number, body: unknown): Promise<void> {
  let tokens = 0;
  if (typeof body === 'object' && body !== null) {
    const usage = (body as { usage?: { total_tokens?: number } }).usage;
    tokens = usage?.total_tokens || 0;
  }
  void recordStats(env, userId, keyId, modelName, { tokens, responseTimeMs, statusCode });
}

async function recordStreamStats(env: Env, userId: string, keyId: string, modelName: string, responseTimeMs: number, statusCode: number): Promise<void> {
  // For streaming, we don't have token counts readily available
  // Use response time as the primary metric; tokens will be 0
  void recordStats(env, userId, keyId, modelName, { tokens: 0, responseTimeMs, statusCode });
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: Errors only in routes/proxy.ts — proxy.ts should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/services/proxy.ts
git commit -m "feat: rewrite proxy service with multi-format and streaming support"
```

---

### Task 8: Rewrite Proxy Routes

**Files:**
- Modify: `src/routes/proxy.ts`

- [ ] **Step 1: Rewrite src/routes/proxy.ts with multi-format route handlers**

```typescript
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
geminiProxyRoutes.post('/models/:model\\:generateContent', handleProxy('gemini'));

function handleProxy(clientFormat: string) {
  return async (c: import('hono').Context<{ Bindings: Env; Variables: { auth: AuthContext } }>) => {
    const rawBody = await c.req.json();
    const auth = c.get('auth');
    const outcome = await proxyRequest(c.env, auth.key_id, auth.user_id, clientFormat, rawBody);

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
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/proxy.ts
git commit -m "feat: add multi-format proxy route handlers (openai, anthropic, gemini)"
```

---

### Task 9: Wire New Routes in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update src/index.ts to register new proxy routes**

```typescript
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
```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire multi-format proxy routes into Hono app"
```

---

### Task 10: Final Typecheck and Verification

**Files:**
- Review: all modified files

- [ ] **Step 1: Run full typecheck**

```bash
npx tsc --noEmit
```

Fix any remaining type errors.

- [ ] **Step 2: Verify all API routes**

| Route | Method | Format | Status |
|---|---|---|---|
| `/v1/chat/completions` | POST | OpenAI (backward compat) | Must still work |
| `/v1/openai/chat/completions` | POST | OpenAI | New |
| `/v1/anthropic/messages` | POST | Anthropic | New |
| `/v1/gemini/models/{model}:generateContent` | POST | Gemini | New |

- [ ] **Step 3: Verify transformer method coverage**

For each of the 3 transformers (openai, anthropic, gemini), verify all 6 methods exist:
- `decodeRequest` ✓
- `encodeRequest` ✓
- `decodeResponse` ✓
- `encodeResponse` ✓
- `decodeStream` ✓
- `encodeStream` ✓

- [ ] **Step 4: Verify passthrough optimization**

When client format === upstream format:
- Non-streaming: raw passthrough (no decodeResponse/encodeResponse)
- Streaming: raw passthrough (no decodeStream/encodeStream)

Check in `src/services/proxy.ts` that the `isPassthrough` branch is correct.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: final type consistency fixes for multi-format streaming"
```
