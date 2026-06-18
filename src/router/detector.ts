import type { OpenAIMessage } from '../types';

export type ContentType = 'text' | 'image' | 'audio' | 'file';

export function detectContentTypes(messages: OpenAIMessage[]): Set<ContentType> {
  const types = new Set<ContentType>();

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      types.add('text');
      continue;
    }

    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') types.add('text');
        if (part.type === 'image_url') types.add('image');
        if (part.type === 'input_audio') types.add('audio');
      }
    }
  }

  if (types.size === 0) types.add('text');
  return types;
}
