import type { Transformer } from './types';
import type { OpenAIRequest, OpenAIResponse, TransformedRequest } from '../types';

export const anthropicTransformer: Transformer = {
  format: 'anthropic',

  transformRequest(req: OpenAIRequest, realModel: string, apiKey: string): TransformedRequest {
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

  transformResponse(body: string, status: number): { body: string; status: number } {
    if (status < 200 || status >= 300) {
      return { body, status };
    }

    try {
      const anthropicResp = JSON.parse(body);
      const usage = anthropicResp.usage || {};

      const openaiResp: OpenAIResponse = {
        id: anthropicResp.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: anthropicResp.model || '',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: extractText(anthropicResp.content),
          },
          finish_reason: mapStopReason(anthropicResp.stop_reason),
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
};

function extractText(content: Array<{ type: string; text?: string }>): string {
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n');
}

function mapStopReason(reason: string): string {
  switch (reason) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'stop_sequence': return 'stop';
    default: return reason || 'stop';
  }
}
