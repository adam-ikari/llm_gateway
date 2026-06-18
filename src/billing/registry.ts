import type { BillingHandler } from './types';

const handlers = new Map<string, BillingHandler>();

export function registerBillingHandler(handler: BillingHandler): void {
  handlers.set(handler.provider, handler);
}

export function getBillingHandler(provider: string): BillingHandler | undefined {
  return handlers.get(provider);
}

export function getRegisteredProviders(): string[] {
  return [...handlers.keys()];
}
