import { describe, it, expect } from 'vitest';
import { geminiTransformer } from '../../transformer/gemini';
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

describe('geminiTransformer', () => {
  it('format is gemini', () => {
    expect(geminiTransformer.format).toBe('gemini');
  });

  // ========== decodeRequest ==========

  describe('decodeRequest', () => {
    it('converts Gemini format (systemInstruction, contents/parts) to OpenAI', () => {
      const body = {
        _model: 'gemini-pro',
        systemInstruction: { parts: [{ text: 'You are helpful' }] },
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
        ],
      };
      const result = geminiTransformer.decodeRequest(body);
      expect(result.model).toBe('gemini-pro');
      expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
      expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('reads _model and _stream from body', () => {
      const body = {
        _model: 'gemini-1.5-pro',
        _stream: true,
        contents: [
          { role: 'user', parts: [{ text: 'Hi' }] },
        ],
      };
      const result = geminiTransformer.decodeRequest(body);
      expect(result.model).toBe('gemini-1.5-pro');
      expect(result.stream).toBe(true);
    });

    it('handles inline_data and file_data parts', () => {
      const body = {
        _model: 'gemini-pro',
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Describe this image' },
              { inline_data: { mime_type: 'image/png', data: 'base64data' } },
              { file_data: { file_uri: 'https://example.com/file', mime_type: 'application/pdf' } },
            ],
          },
        ],
      };
      const result = geminiTransformer.decodeRequest(body);
      const content = result.messages[0].content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
      expect(content[0]).toEqual({ type: 'text', text: 'Describe this image' });
      expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,base64data' } });
      expect(content[2]).toEqual({ type: 'image_url', image_url: { url: 'https://example.com/file' } });
    });

    it('reads generationConfig for max_tokens, temperature, top_p', () => {
      const body = {
        _model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.5,
          topP: 0.9,
        },
      };
      const result = geminiTransformer.decodeRequest(body);
      expect(result.max_tokens).toBe(2048);
      expect(result.temperature).toBe(0.5);
      expect(result.top_p).toBe(0.9);
    });
  });

  // ========== encodeRequest ==========

  describe('encodeRequest', () => {
    it('produces Gemini format with correct URL (streamGenerateContent for stream, generateContent for non-stream)', () => {
      const streamReq: OpenAIRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      };
      const streamResult = geminiTransformer.encodeRequest(streamReq, 'gemini-1.5-pro', 'google-api-key');
      expect(streamResult.url).toContain('streamGenerateContent');

      const nonStreamReq: OpenAIRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const nonStreamResult = geminiTransformer.encodeRequest(nonStreamReq, 'gemini-1.5-pro', 'google-api-key');
      expect(nonStreamResult.url).toContain('generateContent');
      expect(nonStreamResult.url).not.toContain('streamGenerateContent');
    });

    it('handles image_url (data: to inline_data, regular URL to file_data)', () => {
      const req: OpenAIRequest = {
        model: 'gemini-pro',
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
      const result = geminiTransformer.encodeRequest(req, 'gemini-1.5-pro', 'google-api-key');
      const body = JSON.parse(result.body);
      const parts = body.contents[0].parts as Array<Record<string, unknown>>;
      expect(parts[0].inline_data).toEqual({ mime_type: 'image/png', data: 'abc123' });
      expect(parts[1].file_data).toBeDefined();
      expect((parts[1].file_data as Record<string, string>).file_uri).toBe('https://example.com/img.png');
    });

    it('sets correct headers (x-goog-api-key)', () => {
      const req: OpenAIRequest = {
        model: 'gemini-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      };
      const result = geminiTransformer.encodeRequest(req, 'gemini-1.5-pro', 'google-api-key');
      expect(result.headers['Content-Type']).toBe('application/json');
      expect(result.headers['x-goog-api-key']).toBe('google-api-key');
    });
  });

  // ========== decodeResponse ==========

  describe('decodeResponse', () => {
    it('converts Gemini response to OpenAI format', () => {
      const geminiResp = {
        candidates: [{
          content: { parts: [{ text: 'Hello there' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        modelVersion: 'gemini-1.5-pro',
      };
      const result = geminiTransformer.decodeResponse(JSON.stringify(geminiResp), 200);
      const body = JSON.parse(result.body);
      expect(body.object).toBe('chat.completion');
      expect(body.choices[0].message.content).toBe('Hello there');
      expect(body.choices[0].finish_reason).toBe('stop');
      expect(body.usage.prompt_tokens).toBe(10);
      expect(body.usage.completion_tokens).toBe(5);
      expect(body.usage.total_tokens).toBe(15);
    });

    it('preserves error status codes', () => {
      const errorBody = JSON.stringify({ error: { message: 'Not found' } });
      const result = geminiTransformer.decodeResponse(errorBody, 404);
      expect(result.status).toBe(404);
      expect(result.body).toBe(errorBody);
    });
  });

  // ========== encodeResponse ==========

  describe('encodeResponse', () => {
    it('converts OpenAI response to Gemini format', () => {
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
      const result = geminiTransformer.encodeResponse(JSON.stringify(openaiResp), 200);
      const body = JSON.parse(result.body);
      expect(body.candidates[0].content.parts[0].text).toBe('Hi there');
      expect(body.candidates[0].content.role).toBe('model');
      expect(body.candidates[0].finishReason).toBe('STOP');
      expect(body.usageMetadata.promptTokenCount).toBe(10);
      expect(body.usageMetadata.candidatesTokenCount).toBe(5);
      expect(body.usageMetadata.totalTokenCount).toBe(15);
    });
  });

  // ========== decodeStream ==========

  describe('decodeStream', () => {
    it('converts Gemini SSE events to OpenAI SSE chunks', async () => {
      const events: SSEEvent[] = [
        {
          data: JSON.stringify({
            candidates: [{
              content: { parts: [{ text: 'Hello' }], role: 'model' },
            }],
          }),
        },
        {
          data: JSON.stringify({
            candidates: [{
              content: { parts: [{ text: ' world' }], role: 'model' },
              finishReason: 'STOP',
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
          }),
        },
      ];
      const stream = geminiTransformer.decodeStream(toEventStream(events), 'gemini-pro');
      const results = await collectStream(stream);

      // Should have content chunks + finish chunk + [DONE]
      expect(results.length).toBeGreaterThanOrEqual(3);

      const firstChunk = JSON.parse(results[0].data);
      expect(firstChunk.object).toBe('chat.completion.chunk');
      expect(firstChunk.choices[0].delta.content).toBe('Hello');

      const secondChunk = JSON.parse(results[1].data);
      expect(secondChunk.choices[0].delta.content).toBe(' world');

      // Last event before [DONE] should have finish_reason
      const finishChunk = JSON.parse(results[2].data);
      expect(finishChunk.choices[0].finish_reason).toBe('stop');
    });
  });

  // ========== encodeStream ==========

  describe('encodeStream', () => {
    it('converts OpenAI SSE chunks to Gemini SSE events', async () => {
      const openaiEvents: SSEEvent[] = [
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
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        },
      ];
      const stream = geminiTransformer.encodeStream(toEventStream(openaiEvents), 'gemini-pro');
      const results = await collectStream(stream);

      expect(results.length).toBeGreaterThanOrEqual(1);

      const firstChunk = JSON.parse(results[0].data);
      expect(firstChunk.candidates[0].content.parts[0].text).toBe('Hi');
      expect(firstChunk.candidates[0].content.role).toBe('model');

      // Check finish reason in final chunk
      const lastChunk = JSON.parse(results[results.length - 1].data);
      expect(lastChunk.candidates[0].finishReason).toBe('STOP');
    });
  });
});
