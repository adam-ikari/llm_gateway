import type { Transformer } from './types';
import type { OpenAIRequest, TransformedRequest } from '../types';

export const openaiTransformer: Transformer = {
  format: 'openai',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
    const body = {
      ...req,
      model: realModel,
    };
    return {
      url: '',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
  },

  transformResponse(body: string, status: number): { body: string; status: number } {
    return { body, status };
  },
};
