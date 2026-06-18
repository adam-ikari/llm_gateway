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
                choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(d.delta?.stop_reason || '') }],
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
          case 'ping':
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
          controller.enqueue({
            event: 'message_delta',
            data: JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: outputTokens } }),
          });
          controller.enqueue({ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) });
          controller.close();
          return;
        }

        if (value.data === '[DONE]') {
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
          return;
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;

        if (!started) {
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
          controller.enqueue({
            event: 'content_block_start',
            data: JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
          });
          started = true;
        }

        if (delta?.content && typeof delta.content === 'string') {
          outputTokens += 1;
          controller.enqueue({
            event: 'content_block_delta',
            data: JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } }),
          });
        }

        const finishReason = choices?.[0]?.finish_reason as string | undefined;
        if (finishReason) {
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
