import type { OpenAIRequest, TransformedRequest } from '../types';

export interface Transformer {
  format: string;
  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest;
  transformResponse(body: string, status: number): { body: string; status: number };
}
