// Read-only Supabase evidence audit. Never calls CoinAPI or any mutation/RPC.
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error('Storage credentials unavailable.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
const unwrap = ({ data, error }) => {
  if (error) throw new Error(`Storage read failed (${error.code ?? 'unknown'}).`);
  return data;
};
const control = unwrap(await db.from('ht_coinapi_pilot_control')
  .select('enabled,daily_credit_limit,lifetime_credit_limit,daily_reserved,lifetime_reserved,blocked_reason,latest_cycle_id,state')
  .eq('id', 'global').single());
const requests = unwrap(await db.from('ht_coinapi_pilot_requests')
  .select('path,reserved_at,reported_credits,http_status,cycle_id').order('reserved_at').limit(1000));
const groups = {};
for (const row of requests) {
  const kind = row.path.startsWith('/v1/ohlcv/') ? 'candles' : row.path.startsWith('/v1/quotes/') ? 'quotes' : 'catalog';
  const group = groups[kind] ??= { calls: 0, reportedCredits: 0, unknown: 0, errors: 0, limits: {}, markets: {} };
  group.calls++; group.reportedCredits += row.reported_credits ?? 0;
  group.unknown += Number(row.reported_credits === null); group.errors += Number(row.http_status !== 200);
  if (kind === 'candles') {
    const id = row.path.split('/')[3];
    group.markets[id] = (group.markets[id] ?? 0) + 1;
    const limit = new URL(row.path, 'https://rest.coinapi.io').searchParams.get('limit');
    group.limits[limit] = (group.limits[limit] ?? 0) + 1;
  }
}
const cycles = unwrap(await db.from('ht_coinapi_pilot_cycles').select('id,started_at,frame')
  .eq('status', 'complete').order('started_at', { ascending: false }).limit(12));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), providerRequests: 0, mutations: 0,
  control: { ...control, state: undefined }, stateKeys: Object.keys(control.state ?? {}),
  cachedMarkets: Object.keys(control.state?.candleHistory ?? {}).length,
  receipts: { count: requests.length, truncated: requests.length === 1000,
    first: requests[0]?.reserved_at, last: requests.at(-1)?.reserved_at,
    groups: Object.fromEntries(Object.entries(groups).map(([kind, group]) => [kind, { ...group,
      uniqueMarkets: Object.keys(group.markets).length,
      markets: Object.entries(group.markets).sort((a, b) => b[1] - a[1]).slice(0, 10) }])) },
  recentCycles: cycles.map(({ id, started_at, frame }) => ({ id, startedAt: started_at,
    history: frame?.history, selected: frame?.selectedMarkets, scored: frame?.summary?.scored,
    coverage: frame?.coverage?.filter(row => frame?.selectedMarkets?.includes(row.marketId)),
    candles: frame?.evidence?.map(row => ({ marketId: row.identity?.marketId,
      count: row.candles?.length, last: row.candles?.at(-1)?.asOf,
      tradeAsOf: row.trade?.asOf, bookAsOf: row.book?.asOf })) })) }, null, 2));
