-- Keep ProX run-scoped coverage and security-routing verification bounded as
-- append-only discovery history grows. This changes no discovery, scoring,
-- ranking, public, or execution authority.

create index if not exists prox_market_discovery_observations_run_idx
  on public.prox_market_discovery_observations (run_id, id);
