import { describe, it, expect } from 'vitest';
import { openaiTransformer } from '../../transformer/openai';
import type { OpenAIRequest } from '../../types';

describe('openaiTransformer', () => {
  const sampleRequest: OpenAIRequest = {
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  it('format is openai', () => {
    expect(openaiTransformer.format).toBe('openai');
  });

  it('decodeRequest is identity (passthrough)', () => {
    const result = openaiTransformer.decodeRequest(sampleRequest);
    expect(result).toEqual(sampleRequest);
  });

  it('encodeRequest produces correct headers with Bearer auth and JSON content type', () => {
    const result = openaiTransformer.encodeRequest(sampleRequest, 'gpt-4-real', 'sk-test-key');
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('encodeRequest replaces model with realModel', () => {
    const result = openaiTransformer.encodeRequest(sampleRequest, 'gpt-4-real', 'sk-test-key');
    const body = JSON.parse(result.body);
    expect(body.model).toBe('gpt-4-real');
  });

  it('decodeResponse is passthrough', () => {
    const body = '{"id":"test"}';
    const result = openaiTransformer.decodeResponse(body, 200);
    expect(result.body).toBe(body);
    expect(result.status).toBe(200);
  });

  it('encodeResponse is passthrough', () => {
    const body = '{"id":"test"}';
    const result = openaiTransformer.encodeResponse(body, 200);
    expect(result.body).toBe(body);
    expect(result.status).toBe(200);
  });
});
