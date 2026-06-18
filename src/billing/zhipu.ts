import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const zhipuHandler: BillingHandler = {
  provider: 'zhipu',
  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://open.bigmodel.cn').replace(/\/$/, '');
      const resp = await fetch(`${base}/api/paas/v4/report`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };
      const data = await resp.json<{ data: { balance: number } }>();
      return { available: true, total: data.data.balance, remaining: data.data.balance, currency: 'CNY', raw: data };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(zhipuHandler);
