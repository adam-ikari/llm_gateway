import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const anthropicHandler: BillingHandler = {
  provider: 'anthropic',
  async queryBalance(_apiKey: string, _baseUrl?: string): Promise<BalanceResult> {
    return { available: false };
  },
};

registerBillingHandler(anthropicHandler);
