import type { SiteAdapter } from '../adapters/types';

// Adapters are registered here in later phases (MockSellerAdapter, MarketplaceAdapter, AmazonAdapter).
const adapters: SiteAdapter[] = [];

const active = adapters.find((a) => a.detect());
if (active) {
  console.info(`[fargain] adapter active: ${active.id}`);
}
