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
