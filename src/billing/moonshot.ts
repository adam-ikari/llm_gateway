import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const moonshotHandler: BillingHandler = {
  provider: 'moonshot',
  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.moonshot.cn').replace(/\/$/, '');
      const resp = await fetch(`${base}/v1/users/me/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };
      const data = await resp.json<{ data: { balance: number; currency: string } }>();
      return {
        available: true,
        total: data.data.balance,
        remaining: data.data.balance,
        currency: data.data.currency || 'CNY',
        raw: data,
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(moonshotHandler);
