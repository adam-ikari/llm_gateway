import { describe, it, expect } from 'vitest';
import { estimateTokens, fitsInContext } from '../../utils/tokens';
import type { OpenAIRequest } from '../../types';

describe('estimateTokens', () => {
  it('returns a positive number for any request', () => {
    const req: OpenAIRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    };
    const tokens = estimateTokens(req);
    expect(tokens).toBeGreaterThan(0);
  });

  it('scales roughly with string length', () => {
    const short: OpenAIRequest = {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hi' }],
    };
    const long: OpenAIRequest = {
      model: 'gpt-4',
      messages: [
        {
          role: 'user',
          content: 'This is a much longer message that should require significantly more tokens than the short one',
        },
      ],
    };
    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });
});

describe('fitsInContext', () => {
  it('returns true when tokens < 80% of context window', () => {
    // 80% of 10000 = 8000, so 7000 < 8000
    expect(fitsInContext(10000, 7000)).toBe(true);
  });

  it('returns false when tokens >= 80% of context window', () => {
    // 80% of 10000 = 8000, so 8000 >= 8000
    expect(fitsInContext(10000, 8000)).toBe(false);
    // Also test above
    expect(fitsInContext(10000, 9000)).toBe(false);
  });

  it('returns false with 0 context window', () => {
    expect(fitsInContext(0, 0)).toBe(false);
    expect(fitsInContext(0, 1)).toBe(false);
  });
});
