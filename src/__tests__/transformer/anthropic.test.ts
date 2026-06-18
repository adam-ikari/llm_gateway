import { describe, it, expect } from 'vitest';
import { anthropicTransformer } from '../../transformer/anthropic';
import type { OpenAIRequest, SSEEvent } from '../../types';

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const items: T[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    items.push(value);
  }
  return items;
}

function toEventStream(events: SSEEvent[]): ReadableStream<SSEEvent> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event);
      }
      controller.close();
    },
  });
}

describe('anthropicTransformer', () => {
  it('format is anthropic', () => {
    expect(anthropicTransformer.format).toBe('anthropic');
  });

  // ========== decodeRequest ==========

  describe('decodeRequest', () => {
    it('converts Anthropic format (system field, messages with content blocks) to OpenAI', () => {
      const body = {
        model: 'claude-3',
        system: 'You are helpful',
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
        ],
      };
      const result = anthropicTransformer.decodeRequest(body);
      expect(result.model).toBe('claude-3');
      expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
      expect(result.messages[1]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hello' }] });
    });

    it('handles image blocks (base64 source to data URL, url source to image_url)', () => {
      const body = {
        model: 'claude-3',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
              { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
            ],
          },
        ],
      };
      const result = anthropicTransformer.decodeRequest(body);
      const content = result.messages[0].content as Array<{ type: string; image_url?: { url: string } }>;
      expect(content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } });
      expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'https://example.com/img.png' } });
    });

    it('forwards max_tokens, temperature, top_p, stream', () => {
      const body = {
        model: 'claude-3',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
        stream: true,
      };
      const result = anthropicTransformer.decodeRequest(body);
      expect(result.max_tokens).toBe(1024);
      expect(result.temperature).toBe(0.7);
      expect(result.top_p).toBe(0.9);
      expect(result.stream).toBe(true);
    });
  });

  // ========== encodeRequest ==========

  describe('encodeRequest', () => {
    it('extracts system messages, produces Anthropic format', () => {
      const req: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      };
      const result = anthropicTransformer.encodeRequest(req, 'claude-3', 'sk-ant-key');
      const body = JSON.parse(result.body);
      expect(body.system).toBe('You are helpful');
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      // No system message in messages array
      expect(body.messages.some((m: { role: string }) => m.role === 'system')).toBe(false);
    });

    it('handles image_url (data: URL to base64 source, regular URL to url source)', () => {
      const req: OpenAIRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
              { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            ],
          },
        ],
      };
      const result = anthropicTransformer.encodeRequest(req, 'claude-3', 'sk-ant-key');
      const body = JSON.parse(result.body);
      const content = body.messages[0].content as Array<{ type: string; source: Record<string, string> }>;
      expect(content[0].type).toBe('image');
      expect(content[0].source.type).toBe('base64');
      expect(content[0].source.media_type).toBe('image/png');
      expect(content[0].source.data).toBe('abc123');
      expect(content[1].type).toBe('image');
      expect(content[1].source.type).toBe('url');
      expect(content[1].source.url).toBe('https://example.com/img.png');
    });

    it('forwards temperature, top_p, stream; defaults max_tokens to 4096', () => {
      const req: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
        top_p: 0.8,
        stream: true,
      };
      const result = anthropicTransformer.encodeRequest(req, 'claude-3', 'sk-ant-key');
      const body = JSON.parse(result.body);
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.8);
      expect(body.stream).toBe(true);
    });

    it('sets correct headers (x-api-key, anthropic-version)', () => {
      const req: OpenAIRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const result = anthropicTransformer.encodeRequest(req, 'claude-3', 'sk-ant-key');
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['x-api-key']).toBe('sk-ant-key');
      expect(result.headers['anthropic-version']).toBe('2023-06-01');
    });
  });

  // ========== decodeResponse ==========

  describe('decodeResponse', () => {
    it('converts Anthropic response to OpenAI format', () => {
      const anthropicResp = {
        id: 'msg_123',
        model: 'claude-3',
        content: [{ type: 'text', text: 'Hello there' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      const result = anthropicTransformer.decodeResponse(JSON.stringify(anthropicResp), 200);
      const body = JSON.parse(result.body);
      expect(body.object).toBe('chat.completion');
      expect(body.choices[0].message.role).toBe('assistant');
      expect(body.choices[0].message.content).toBe('Hello there');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage.prompt_tokens).toBe(10);
      expect(body.usage.completion_tokens).toBe(5);
      expect(body.usage.total_tokens).toBe(15);
    });

    it('preserves error status codes', () => {
      const errorBody = JSON.stringify({ error: { message: 'Unauthorized' } });
      const result = anthropicTransformer.decodeResponse(errorBody, 401);
      expect(result.status).toBe(401);
      expect(result.body).toBe(errorBody);
    });
  });

  // ========== encodeResponse ==========

  describe('encodeResponse', () => {
    it('converts OpenAI response to Anthropic format', () => {
      const openaiResp = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hi there' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const result = anthropicTransformer.encodeResponse(JSON.stringify(openaiResp), 200);
      const body = JSON.parse(result.body);
      expect(body.type).toBe('message');
      expect(body.role).toBe('assistant');
      expect(body.content[0]).toEqual({ type: 'text', text: 'Hi there' });
      expect(body.stop_reason).toBe('end_turn');
      expect(body.usage.input_tokens).toBe(10);
      expect(body.usage.output_tokens).toBe(5);
    });
  });

  // ========== decodeStream ==========

  describe('decodeStream', () => {
    it('converts Anthropic SSE events to OpenAI SSE chunks', async () => {
      const events: SSEEvent[] = [
        {
          event: 'message_start',
          data: JSON.stringify({
            message: { id: 'msg_abc', usage: { input_tokens: 10 } },
          }),
        },
        {
          event: 'content_block_delta',
          data: JSON.stringify({ delta: { type: 'text_delta', text: 'Hello' } }),
        },
        {
          event: 'message_delta',
          data: JSON.stringify({ delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }),
        },
      ];
      const stream = anthropicTransformer.decodeStream(toEventStream(events), 'claude-3');
      const results = await collectStream(stream);

      // message_start -> first chunk, content_block_delta -> content chunk, message_delta -> finish chunk, then [DONE]
      expect(results.length).toBeGreaterThanOrEqual(3);

      const firstChunk = JSON.parse(results[0].data);
      expect(firstChunk.object).toBe('chat.completion.chunk');
      expect(firstChunk.choices[0].delta.role).toBe('assistant');

      const contentChunk = JSON.parse(results[1].data);
      expect(contentChunk.choices[0].delta.content).toBe('Hello');

      const lastChunk = JSON.parse(results[2].data);
      expect(lastChunk.choices[0].finish_reason).toBe('stop');
    });
  });

  // ========== encodeStream ==========

  describe('encodeStream', () => {
    it('converts OpenAI SSE chunks to Anthropic SSE events', async () => {
      const openaiEvents: SSEEvent[] = [
        {
          data: JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
          }),
        },
        {
          data: JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
          }),
        },
        {
          data: JSON.stringify({
            id: 'chatcmpl-1',
            object: 'chat.completion.chunk',
            created: 1234567890,
            model: 'gpt-4',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }),
        },
      ];
      const stream = anthropicTransformer.encodeStream(toEventStream(openaiEvents), 'claude-3');
      const results = await collectStream(stream);

      // Should have: message_start, content_block_start, content_block_delta, content_block_stop, message_delta, message_stop
      const eventTypes = results.map((e) => e.event);
      expect(eventTypes).toContain('message_start');
      expect(eventTypes).toContain('content_block_start');
      expect(eventTypes).toContain('content_block_delta');
      expect(eventTypes).toContain('message_stop');

      // Check content_block_delta has the text
      const deltaEvent = results.find((e) => e.event === 'content_block_delta');
      const deltaData = JSON.parse(deltaEvent!.data);
      expect(deltaData.delta.text).toBe('Hi');
    });
  });
});
