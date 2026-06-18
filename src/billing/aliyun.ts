import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const aliyunHandler: BillingHandler = {
  provider: 'aliyun',
  async queryBalance(apiKey: string, _baseUrl?: string): Promise<BalanceResult> {
    try {
      const resp = await fetch('https://dashscope.aliyuncs.com/api/v1/billing/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };
      const data = await resp.json<{ output: { balance: number } }>();
      return {
        available: true,
        total: data.output.balance,
        remaining: data.output.balance,
        currency: 'CNY',
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(aliyunHandler);
