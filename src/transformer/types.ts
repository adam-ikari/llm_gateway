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
