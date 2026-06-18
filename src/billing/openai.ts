import type { BillingHandler, BalanceResult } from './types';
import { registerBillingHandler } from './registry';

const openaiHandler: BillingHandler = {
  provider: 'openai',

  async queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult> {
    try {
      const base = (baseUrl || 'https://api.openai.com').replace(/\/$/, '');
      const subResp = await fetch(`${base}/v1/dashboard/billing/subscription`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!subResp.ok) return { available: false };
      const sub = await subResp.json<{ hard_limit_usd: number; soft_limit_usd: number }>();

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const usageResp = await fetch(`${base}/v1/usage?date=${startDate}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!usageResp.ok) return { available: false };
      const usage = await usageResp.json<{ total_usage: number }>();

      const total = sub.hard_limit_usd;
      const used = usage.total_usage / 100;
      const remaining = total - used;

      return {
        available: true,
        total: Math.round(total * 100) / 100,
        used: Math.round(used * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        currency: 'USD',
        raw: { subscription: sub, usage },
      };
    } catch {
      return { available: false };
    }
  },
};

registerBillingHandler(openaiHandler);
