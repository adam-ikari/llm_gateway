import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const deepseekHandler: BillingHandler = {
  provider: 'deepseek',
  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
      const resp = await fetch(`${base}/user/balance`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return { available: false };
      const data = await resp.json<{ balance_infos: Array<{ total_balance: string; currency: string }> }>();
      const total = parseFloat(data.balance_infos?.[0]?.total_balance || '0');
      const currency = data.balance_infos?.[0]?.currency || 'CNY';
      return { available: true, total, remaining: total, currency, raw: data };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(deepseekHandler);
