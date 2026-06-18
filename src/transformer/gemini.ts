import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export const geminiTransformer: Transformer = {
  format: 'gemini',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
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

  transformResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const geminiResp = JSON.parse(body);
      const candidates = geminiResp.candidates || [];
      const first = candidates[0]?.content?.parts || [];
      const text = first.filter((p: { text?: string }) => p.text).map((p: { text?: string }) => p.text).join('\n');

      const openaiResp: OpenAIResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: geminiResp.modelVersion || '',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: mapGeminiFinishReason(candidates[0]?.finishReason),
        }],
        usage: {
          prompt_tokens: geminiResp.usageMetadata?.promptTokenCount || 0,
          completion_tokens: geminiResp.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: geminiResp.usageMetadata?.totalTokenCount || 0,
        },
      };

      return { body: JSON.stringify(openaiResp), status: 200 };
    } catch {
      return { body, status };
    }
  },
};

function mapGeminiFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    default: return reason || 'stop';
  }
}
