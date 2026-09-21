-- Product-integrity security receipts. This migration does not change trading,
-- scoring, ranking, provider, Paper, Agent, or brokerage authority.

create table if not exists public.ht_public_api_rate_limits (
  bucket_key text primary key,
  namespace text not null,
  identity_hash text not null,
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  request_count integer not null check (request_count >= 1),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists ht_public_api_rate_limits_updated_idx
  on public.ht_public_api_rate_limits (updated_at);

alter table public.ht_public_api_rate_limits enable row level security;
revoke all on table public.ht_public_api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.ht_public_api_rate_limits to service_role;

create or replace function public.ht_consume_public_api_rate_limit(
  p_namespace text,
  p_identity_hash text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '1500ms'
as $$
declare
  n timestamptz := clock_timestamp();
  bounded_limit integer := least(10000, greatest(1, coalesce(p_limit, 1)));
  bounded_window integer := least(86400, greatest(1, coalesce(p_window_seconds, 60)));
  window_start timestamptz;
  key text;
  current_count integer;
begin
  if coalesce(p_namespace, '') !~ '^[a-z0-9][a-z0-9_-]{1,63}$' or
     coalesce(p_identity_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate-limit identity';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from n) / bounded_window) * bounded_window
  );
  key := p_namespace || ':' || p_identity_hash || ':' || extract(epoch from window_start)::bigint;

  insert into public.ht_public_api_rate_limits (
    bucket_key, namespace, identity_hash, window_started_at,
    window_seconds, request_count, updated_at
  ) values (
    key, p_namespace, p_identity_hash, window_start,
    bounded_window, 1, n
  )
  on conflict (bucket_key) do update set
    request_count = public.ht_public_api_rate_limits.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into current_count;

  return jsonb_build_object(
    'allowed', current_count <= bounded_limit,
    'limit', bounded_limit,
    'remaining', greatest(0, bounded_limit - current_count),
    'resetAt', extract(epoch from (window_start + make_interval(secs => bounded_window)))::bigint,
    'scope', 'global',
    'contractVersion', 'ht-public-api-rate-limit-v1'
  );
end;
$$;

revoke all on function public.ht_consume_public_api_rate_limit(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.ht_consume_public_api_rate_limit(text,text,integer,integer)
  to service_role;

create table if not exists public.ht_external_request_telemetry (
  id bigint generated always as identity primary key,
  endpoint text not null,
  provider text not null,
  operation text not null,
  request_count integer not null check (request_count between 0 and 10000),
  input_tokens integer,
  output_tokens integer,
  outcome text not null check (outcome in ('success','unavailable','rate_limited','error')),
  source_timestamp timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default clock_timestamp(),
  check (input_tokens is null or input_tokens >= 0),
  check (output_tokens is null or output_tokens >= 0),
  check (jsonb_typeof(metadata) = 'object'),
  check (length(metadata::text) <= 4000)
);

create index if not exists ht_external_request_telemetry_recorded_idx
  on public.ht_external_request_telemetry (recorded_at desc);

alter table public.ht_external_request_telemetry enable row level security;
revoke all on table public.ht_external_request_telemetry from public, anon, authenticated;
grant select, insert on table public.ht_external_request_telemetry to service_role;

create or replace function public.ht_product_integrity_guardrails_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '1000ms'
as $$
begin
  return jsonb_build_object(
    'verified', true,
    'migrationLevel', '0060_product_integrity_guardrails',
    'rateLimitContractVersion', 'ht-public-api-rate-limit-v1',
    'globalRateLimitReady', to_regclass('public.ht_public_api_rate_limits') is not null,
    'telemetryReady', to_regclass('public.ht_external_request_telemetry') is not null,
    'scoringAuthorityChanged', false,
    'executionAuthorityChanged', false
  );
end;
$$;

revoke all on function public.ht_product_integrity_guardrails_health()
  from public, anon, authenticated;
grant execute on function public.ht_product_integrity_guardrails_health()
  to service_role;
