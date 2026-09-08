-- READ ONLY, after migration 0038. No provider requests or collection activation.
-- Return this compact result; it contains no API keys or raw market frames.
with snapshot as (select public.ht_crypto_evidence_health_snapshot() as s)
select jsonb_build_object(
  'version',s->'version',
  'checked_at',s->'checkedAt',
  'archive',s->'archive',
  'control',s->'control',
  'latest_attempt',s->'latestAttempt',
  'publication',jsonb_build_object(
    'id',s#>'{publication,id}',
    'status',s#>'{publication,status}',
    'started_at',s#>'{publication,started_at}',
    'completed_at',s#>'{publication,completed_at}',
    'decision_at',s#>'{publication,frame,decisionAt}',
    'coverage',s#>'{publication,frame,summary}',
    'usage',s#>'{publication,frame,usage}'
  ),
  'request_receipts',s->'receipts',
  'outcome_coverage',s->'ledger',
  'outcome_integrity',s->'ledgerIntegrity'
) as crypto_health_verification
from snapshot;
