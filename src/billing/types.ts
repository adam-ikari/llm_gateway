export interface BalanceResult {
  available: boolean;
  total?: number;
  used?: number;
  remaining?: number;
  currency?: string;
  raw?: unknown;
}

export interface BillingHandler {
  provider: string;
  queryBalance(apiKey: string, baseUrl?: string): Promise<BalanceResult>;
}
