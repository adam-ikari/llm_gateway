import { describe, it, expect } from 'vitest';
import { detectContentTypes } from '../../router/detector';
import type { OpenAIMessage } from '../../types';

describe('detectContentTypes', () => {
  it('detects text from string content', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'Hello world' }];
    const types = detectContentTypes(messages);
    expect(types.has('text')).toBe(true);
    expect(types.size).toBe(1);
  });

  it('detects text from array with text part', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];
    const types = detectContentTypes(messages);
    expect(types.has('text')).toBe(true);
  });

  it('detects image from image_url part', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
      },
    ];
    const types = detectContentTypes(messages);
    expect(types.has('image')).toBe(true);
  });

  it('detects audio from input_audio part', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: 'base64data', format: 'wav' } }],
      },
    ];
    const types = detectContentTypes(messages);
    expect(types.has('audio')).toBe(true);
  });

  it('detects multiple types from mixed content', () => {
    const messages: OpenAIMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this' },
          { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          { type: 'input_audio', input_audio: { data: 'base64data', format: 'mp3' } },
        ],
      },
    ];
    const types = detectContentTypes(messages);
    expect(types.has('text')).toBe(true);
    expect(types.has('image')).toBe(true);
    expect(types.has('audio')).toBe(true);
    expect(types.size).toBe(3);
  });

  it('defaults to text when no content', () => {
    const messages: OpenAIMessage[] = [];
    const types = detectContentTypes(messages);
    expect(types.has('text')).toBe(true);
    expect(types.size).toBe(1);
  });
});
