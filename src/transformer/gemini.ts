import type { Transformer } from './types';
import type {
  OpenAIRequest,
  OpenAIResponse,
  OpenAIMessage,
  OpenAIContentPart,
  TransformedRequest,
  SSEEvent,
} from '../types';

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
      model: (b._model as string) || '',
      messages,
    };

    if (genConfig?.maxOutputTokens !== undefined) request.max_tokens = genConfig.maxOutputTokens as number;
    if (genConfig?.temperature !== undefined) request.temperature = genConfig.temperature as number;
    if (genConfig?.topP !== undefined) request.top_p = genConfig.topP as number;
    if (b._stream) request.stream = true;

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

    const generationConfig: Record<string, unknown> = { maxOutputTokens: req.max_tokens ?? 4096 };
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.top_p !== undefined) generationConfig.topP = req.top_p;

    const body: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemInstructions.length > 0) {
      body.systemInstruction = { parts: [{ text: systemInstructions.join('\n') }] };
    }

    return {
      url: req.stream
        ? `/v1beta/models/${realModel}:streamGenerateContent?alt=sse`
        : `/v1beta/models/${realModel}:generateContent`,
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
      const text = first
        .filter((p: { text?: string }) => p.text)
        .map((p: { text?: string }) => p.text)
        .join('\n');

      const openaiResp: OpenAIResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: resp.modelVersion || '',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: mapGeminiFinishReason(candidates[0]?.finishReason),
          },
        ],
        usage: {
          prompt_tokens: resp.usageMetadata?.promptTokenCount || 0,
          completion_tokens: resp.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: resp.usageMetadata?.totalTokenCount || 0,
        },
      };

      return { body: JSON.stringify(openaiResp), status };
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
        candidates: [
          {
            content: {
              parts: [{ text: content || '' }],
              role: 'model',
            },
            finishReason: mapFinishReasonToGemini(finishReason),
          },
        ],
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
          return;
        }

        if (data.error) {
          controller.enqueue({
            data: JSON.stringify({
              error: {
                message: (data.error as Record<string, string>).message || 'Upstream error',
                type: 'upstream_error',
              },
            }),
          });
          controller.enqueue({ data: '[DONE]' });
          controller.close();
          return;
        }

        const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
        const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as
          | Array<Record<string, unknown>>
          | undefined;
        const finishReason = candidates?.[0]?.finishReason as string | undefined;
        const usageMeta = data.usageMetadata as Record<string, number> | undefined;

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
        const finishReason = choices?.[0]?.finish_reason as string | undefined;
        const usage = chunk.usage as Record<string, number> | undefined;

        const parts: Array<Record<string, unknown>> = [];

        if (delta?.content && typeof delta.content === 'string') {
          parts.push({ text: delta.content });
        }

        const geminiChunk: Record<string, unknown> = {};

        if (parts.length > 0) {
          geminiChunk.candidates = [
            {
              content: { parts, role: 'model' },
            },
          ];
        }

        if (finishReason) {
          if (!geminiChunk.candidates) {
            geminiChunk.candidates = [{ content: { parts: [], role: 'model' } }];
          }
          (geminiChunk.candidates as Array<Record<string, unknown>>)[0].finishReason =
            mapFinishReasonToGemini(finishReason);
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
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
      return 'content_filter';
    default:
      return reason || 'stop';
  }
}

function mapFinishReasonToGemini(reason: string | undefined): string {
  switch (reason) {
    case 'stop':
      return 'STOP';
    case 'length':
      return 'MAX_TOKENS';
    case 'content_filter':
      return 'SAFETY';
    default:
      return 'STOP';
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
