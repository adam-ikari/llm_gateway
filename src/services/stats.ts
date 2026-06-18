import type { Env } from '../index';

export async function recordStats(
  _env: Env,
  _userId: string,
  _keyId: string,
  _modelName: string,
  _data: { tokens: number; responseTimeMs: number; statusCode: number },
): Promise<void> {
  // Stub - will be replaced in Task 15
}
