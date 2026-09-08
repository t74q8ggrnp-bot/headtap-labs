# Phase 1 market-chart provider cost guard

The stock workspace keeps its five-second transport cadence, but identical
Massive evidence requests now pass through a bounded server-side single-flight
guard. The guard:

- keys only on operation, normalized symbol, request variant, and the current
  five-second bucket (never on credentials);
- lets one request perform provider work while simultaneous requests in the
  same server process await that promise;
- reuses admitted evidence for at most 4.5 seconds and never across the next
  five-second bucket;
- never retains thrown errors, unsuccessful provider results, empty evidence,
  or active-session evidence that fails its provider-timestamp freshness test;
- keeps at most 256 retained/in-flight keys per process;
- leaves browser responses and per-IP rate-limit headers uncached.

Each accepted REST frame records which evidence came directly from Massive,
joined an in-flight request, or came from the short TTL. `providerRequestCount`
counts only provider calls initiated by that server request;
`acceptedEvidenceCount` and `reusedEvidenceCount` make reuse visible. The
legacy comparison remains a model, not a provider billing ledger. Streaming
deltas may omit REST instrumentation entirely, and those events are excluded
from the REST comparison.

## Deliberate Phase 1 boundary

The guard is process-local. Separate serverless instances and regions do not
share its map, and the existing public per-IP limiter is also process-local.
Consequently this reduces duplicate calls among simultaneous consumers that
land on the same warm instance, but it is not a durable global spending cap.
A cross-instance cap requires explicitly approved shared infrastructure (for
example a low-latency shared store or provider gateway), operational ownership,
and failure-mode design. Phase 1 does not pretend that infrastructure exists.
