import type { OpenAIRequest } from '../types';

const CHARS_PER_TOKEN = 4;
const SAFETY_MARGIN = 0.8;

export function estimateTokens(request: OpenAIRequest): number {
  const body = JSON.stringify(request);
  return Math.ceil(body.length / CHARS_PER_TOKEN);
}

export function fitsInContext(contextWindow: number, requestTokens: number): boolean {
  return requestTokens < contextWindow * SAFETY_MARGIN;
}
