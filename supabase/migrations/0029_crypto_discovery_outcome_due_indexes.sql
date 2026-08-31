-- Keep each multi-venue crypto outcome horizon independently searchable.
--
-- The original composite due index begins with target_15m_at, so it cannot
-- efficiently serve the separate 1h, 4h, and 24h backlog queries. These
-- partial indexes cover only unresolved venue-qualified observations and do
-- not change scoring, eligibility, or public crypto authority.

create index if not exists ht_crypto_discovery_15m_due_idx
  on public.ht_crypto_discovery_observations (target_15m_at)
  where price_15m_usd is null
    and asset_id like 'crypto:%:%';

create index if not exists ht_crypto_discovery_1h_due_idx
  on public.ht_crypto_discovery_observations (target_1h_at)
  where price_1h_usd is null
    and asset_id like 'crypto:%:%';

create index if not exists ht_crypto_discovery_4h_due_idx
  on public.ht_crypto_discovery_observations (target_4h_at)
  where price_4h_usd is null
    and asset_id like 'crypto:%:%';

create index if not exists ht_crypto_discovery_24h_due_idx
  on public.ht_crypto_discovery_observations (target_24h_at)
  where price_24h_usd is null
    and asset_id like 'crypto:%:%';
